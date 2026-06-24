// Memory consolidation sweep (#221 ⑨). Periodic, off the hot path: removes
// redundancy so the bounded hot-set stays injectable and the Memory tab stays
// clean. Mirrors decay-extracted: runs ONCE PER USER SCOPE via runWithUserScope.
//
// Cluster-gated, not pressure-gated: a cheap lexical pre-filter finds plausible
// near-duplicate clusters per category, and MERGE runs whenever a cluster exists
// (redundancy is visible — in recall + the Memory tab — at ANY scale). RESHAPE
// alone is cost-gated: it only fires when the store is over the inject-all ceiling
// (USER_CAP entries OR USER_CHAR_BUDGET chars). Either way the pre-filter bounds
// model cost — no clusters + no pressure ⇒ no model call. The model proposes ops;
// we apply them via the bitemporal query layer (reversible, explicit-protected).
import "server-only";
import { runWithUserScope } from "../db/context";
import { listUserIds } from "../db/queries/admin";
import {
  listActive,
  mergeMemories,
  type Preference,
  type PreferenceCategory,
  update,
} from "../db/queries/preferences";
import { type ConsolidationOp, proposeConsolidation } from "../memory/consolidate";
import { USER_CAP, USER_CHAR_BUDGET } from "../memory/inject";

export type ProposeFn = (
  category: PreferenceCategory,
  rows: Preference[],
) => Promise<ConsolidationOp[]>;

export interface ConsolidateOptions {
  /** User scopes to sweep (default: NULL owner + every registered user). */
  scopes?: (string | null)[];
  /** Model proposer — injectable for tests. Defaults to the real model sweep. */
  propose?: ProposeFn;
  /** Cap on ops applied per scope (safety). */
  maxOpsPerScope?: number;
}

export interface ConsolidateResult {
  scopesSwept: (string | null)[];
  /** Scopes where the sweep found work (near-dup clusters, or over-pressure reshapes). */
  scopesWorked: number;
  /** Rows merged away (collapsed into a survivor). */
  mergedCount: number;
  /** Rows reshaped (content→detail). */
  reshapedCount: number;
  /** Rows recategorized. */
  recategorizedCount: number;
}

const DEFAULT_MAX_OPS = 50;

// Normalize content for lexical comparison: lowercase, strip punctuation,
// collapse whitespace into a token set.
function tokenSet(content: string): Set<string> {
  const toks = content.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(toks);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Cheap lexical pre-filter: group rows whose normalized token sets overlap
 * beyond `threshold` (transitive clusters of size ≥ 2). Only these plausible
 * near-dup clusters are worth a model call. Pure — unit-testable.
 */
export function findNearDupClusters(rows: Preference[], threshold = 0.5): Preference[][] {
  const sets = rows.map((r) => tokenSet(r.content));
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    return root;
  };
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (jaccard(sets[i], sets[j]) >= threshold) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Preference[]>();
  for (let i = 0; i < rows.length; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(rows[i]);
    else groups.set(root, [rows[i]]);
  }
  return [...groups.values()].filter((g) => g.length >= 2);
}

// Is the scope over the inject-all ceiling (so consolidation is worth running)?
function underPressure(rows: Preference[]): boolean {
  if (rows.length > USER_CAP) return true;
  const chars = rows.reduce((sum, r) => sum + r.content.length, 0);
  return chars > USER_CHAR_BUDGET;
}

// Apply one op, returning which counters to bump. Explicit-protected: a merge's
// survivor is forced to an explicit row when the cluster has one (an inference
// can never supersede a user-stated fact).
function applyOp(
  op: ConsolidationOp,
  byId: Map<number, Preference>,
): "merged" | "reshaped" | "recategorized" | null {
  if (op.op === "merge") {
    const rows = op.ids.map((id) => byId.get(id)).filter((r): r is Preference => !!r);
    if (rows.length < 2) return null;
    // Survivor = an explicit row if any (explicit-protected — an inference can
    // never supersede a user-stated fact), else highest confidence then lowest id.
    const survivor =
      rows.find((r) => r.confidence == null) ??
      [...rows].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || a.id - b.id)[0];
    const losers = rows.filter((r) => r.id !== survivor.id).map((r) => r.id);
    const n = mergeMemories(survivor.id, losers);
    return n > 0 ? "merged" : null;
  }
  if (op.op === "reshape") {
    const row = byId.get(op.id);
    if (!row || !op.content) return null;
    update(String(op.id), op.content, { detail: op.detail });
    return "reshaped";
  }
  // recategorize: keep content, change category.
  const row = byId.get(op.id);
  if (!row || row.category === op.category) return null;
  update(String(op.id), row.content, { category: op.category });
  return "recategorized";
}

const CATEGORIES: PreferenceCategory[] = ["user", "advisor"];

export async function consolidateMemory(
  options: ConsolidateOptions = {},
): Promise<ConsolidateResult> {
  const scopes = options.scopes ?? [null, ...listUserIds()];
  const propose = options.propose ?? proposeConsolidation;
  const maxOps = options.maxOpsPerScope ?? DEFAULT_MAX_OPS;
  const result: ConsolidateResult = {
    scopesSwept: scopes,
    scopesWorked: 0,
    mergedCount: 0,
    reshapedCount: 0,
    recategorizedCount: 0,
  };

  for (const userId of scopes) {
    await runWithUserScope(userId, async () => {
      const active = listActive();
      // Merge runs whenever the cheap lexical pre-filter finds a near-dup cluster
      // (redundancy is visible — in recall + the Memory tab — at ANY scale, not
      // just over the ceiling). Reshape is a cost concern, so it only kicks in
      // when the store is actually over the char budget. The pre-filter bounds
      // model cost: no clusters + no pressure ⇒ no model call.
      const pressure = underPressure(active);
      let applied = 0;
      let worked = false;
      for (const category of CATEGORIES) {
        if (applied >= maxOps) break;
        const rows = active.filter((r) => r.category === category);
        const clusters = findNearDupClusters(rows);
        const hasLong =
          pressure && rows.some((r) => r.content.length > USER_CHAR_BUDGET / USER_CAP);
        if (clusters.length === 0 && !hasLong) continue;
        worked = true;
        const ops = await propose(category, rows);
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const op of ops) {
          if (applied >= maxOps) break;
          const kind = applyOp(op, byId);
          if (kind === "merged") result.mergedCount++;
          else if (kind === "reshaped") result.reshapedCount++;
          else if (kind === "recategorized") result.recategorizedCount++;
          if (kind) applied++;
        }
      }
      if (worked) result.scopesWorked++;
    });
  }
  return result;
}
