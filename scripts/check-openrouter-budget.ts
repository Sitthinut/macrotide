// Early-warning probe for OpenRouter ACCOUNT spend (issue #183).
//
// Reads the account key's live monthly limit + remaining from OpenRouter's
// `GET /api/v1/key`, classifies how close spend is to the cap, and signals the
// result via exit code (+ a logged line) for a server-side monitor to consume.
//
// Design — single source of truth, no local state:
//   The cap lives ONLY in the OpenRouter dashboard (the key's monthly limit).
//   This probe READS it live — it never re-declares the number, so nothing can
//   drift. Monthly usage only climbs until the calendar-month reset, so crossing
//   a threshold is a one-way trip within the month: no state file, no snapshot,
//   no manual reset, and it can't flap.
//
// Two independent spend guards, kept distinct:
//   - per-USER daily token/cents cap (lib/db/queries/usage.ts) — bounds one user.
//   - per-KEY account guard (THIS probe) — bounds total account spend before the
//     403 that would break ALL chat.
//
// Usage:
//   npm run jobs:check-budget [-- [--warn-pct=N] [--crit-pct=N]]
//
// Exit code IS the signalling contract for server-side ops:
//   0   healthy / warn / indeterminate (API error, no key limit) — never page.
//   10  critical (>= crit-pct of the limit used) — an act-now budget alert.
// Warn logs a WARN line but stays exit 0, so a near-threshold reading doesn't page.
// Any internal probe error also exits 0 — a bug here must never masquerade as a
// budget breach; a crashed/silent probe is caught by the optional dead-man
// heartbeat, not by a false page.
//
// Loads .env.local via tsx's --env-file flag (configured in package.json). On the
// box it runs via scripts/run-job.sh against the same key the app uses.

import { fileURLToPath } from "node:url";

const KEY_ENDPOINT = "https://openrouter.ai/api/v1/key";

// Generic best-practice defaults — NOT account-specific. The dollar cap is read
// from OpenRouter, never hard-coded here; only these percentages have defaults,
// overridable per-environment via flags on the job unit.
export const DEFAULT_WARN_PCT = 80;
export const DEFAULT_CRIT_PCT = 95;

/** Non-zero exit reserved for a critical (act-now) budget alert. */
export const CRITICAL_EXIT_CODE = 10;

export interface CliArgs {
  warnPct: number;
  critPct: number;
}

/** Parse CLI argv into typed options. Pure — safe to unit-test. */
export function parseArgs(argv: string[]): CliArgs {
  let warnPct = DEFAULT_WARN_PCT;
  let critPct = DEFAULT_CRIT_PCT;
  for (const arg of argv) {
    const warn = arg.match(/^--warn-pct=(\d+(?:\.\d+)?)$/);
    if (warn) {
      const n = Number.parseFloat(warn[1]);
      if (n > 0 && n <= 100) warnPct = n;
      continue;
    }
    const crit = arg.match(/^--crit-pct=(\d+(?:\.\d+)?)$/);
    if (crit) {
      const n = Number.parseFloat(crit[1]);
      if (n > 0 && n <= 100) critPct = n;
    }
  }
  return { warnPct, critPct };
}

/** The two fields the verdict depends on, normalized to number | null. */
export interface KeyUsage {
  limit: number | null;
  limitRemaining: number | null;
}

export type BudgetStatus = "healthy" | "warn" | "critical" | "indeterminate";

/**
 * Percent of the monthly limit consumed: `(limit - remaining) / limit * 100`.
 * Pure. Returns null when the limit isn't a usable positive number (no key limit
 * set, or a malformed/absent field) — the caller fails OPEN on null. Can exceed
 * 100 when the key is already over its limit (negative `remaining`).
 */
export function pctUsed(usage: KeyUsage): number | null {
  const { limit, limitRemaining } = usage;
  if (limit === null || !Number.isFinite(limit) || limit <= 0) return null;
  if (limitRemaining === null || !Number.isFinite(limitRemaining)) return null;
  return ((limit - limitRemaining) / limit) * 100;
}

/**
 * Classify spend against the key's monthly limit. Pure. `indeterminate` (→ the
 * caller exits 0) when the limit can't be read, so a missing limit or a bad field
 * is never a false "critical". Boundaries are inclusive (`>=`).
 */
export function classify(usage: KeyUsage, warnPct: number, critPct: number): BudgetStatus {
  const pct = pctUsed(usage);
  if (pct === null) return "indeterminate";
  if (pct >= critPct) return "critical";
  if (pct >= warnPct) return "warn";
  return "healthy";
}

/** Map a status to its process exit code. Non-zero ONLY for critical. */
export function exitCodeFor(status: BudgetStatus): number {
  return status === "critical" ? CRITICAL_EXIT_CODE : 0;
}

/** Shape of the bits of `GET /api/v1/key` we read (everything else ignored). */
interface KeyResponse {
  data?: {
    limit?: number | null;
    limit_remaining?: number | null;
    usage_monthly?: number | null;
    label?: string | null;
  };
}

interface KeyReading {
  usage: KeyUsage;
  usageMonthly: number | null;
  label: string | null;
}

async function fetchKeyReading(apiKey: string): Promise<KeyReading> {
  const res = await fetch(KEY_ENDPOINT, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.PUBLIC_APP_URL ?? "https://macrotide.local",
      "X-Title": "Macrotide",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`OpenRouter /key returned HTTP ${res.status}`);
  const json = (await res.json()) as KeyResponse;
  const d = json.data ?? {};
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    usage: { limit: num(d.limit), limitRemaining: num(d.limit_remaining) },
    usageMonthly: num(d.usage_monthly),
    label: typeof d.label === "string" ? d.label : null,
  };
}

const money = (v: number | null): string => (v === null ? "n/a" : `$${v.toFixed(2)}`);

async function main(): Promise<void> {
  const { warnPct, critPct } = parseArgs(process.argv.slice(2));

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // Fail OPEN — a missing key is a config gap, not a budget breach. Never page.
    console.log("budget: indeterminate (OPENROUTER_API_KEY unset) — exit 0");
    return;
  }

  let reading: KeyReading;
  try {
    reading = await fetchKeyReading(apiKey);
  } catch (err) {
    // An API hiccup is NOT a budget breach — exit 0 and let the server-side
    // "no signal" timeout surface a stuck/crashed probe instead.
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`budget: indeterminate (could not read OpenRouter /key: ${msg}) — exit 0`);
    return;
  }

  const status = classify(reading.usage, warnPct, critPct);
  const pct = pctUsed(reading.usage);
  const pctStr = pct === null ? "n/a" : `${pct.toFixed(1)}%`;
  const labelStr = reading.label ? ` key=${reading.label}` : "";

  // One greppable summary line, logged regardless of verdict.
  const line =
    `budget: ${status}${labelStr} used=${pctStr} limit=${money(reading.usage.limit)} ` +
    `remaining=${money(reading.usage.limitRemaining)} usage_monthly=${money(reading.usageMonthly)} ` +
    `(warn=${warnPct}% crit=${critPct}%)`;

  if (status === "critical") {
    console.error(line);
  } else if (status === "warn") {
    console.warn(line);
  } else {
    console.log(line);
    if (status === "indeterminate" && reading.usage.limit === null) {
      console.log(
        "budget: no monthly limit set on this key — set one in the OpenRouter " +
          "dashboard for this probe to track spend.",
      );
    }
  }

  // Dead-man liveness: ping the heartbeat on a healthy/warn run so a server-side
  // "silence = problem" monitor notices a crashed/stuck probe. Deliberately NOT
  // pinged on critical (so that monitor can double as the budget signal if wired
  // that way) nor on indeterminate (a broken read must not look healthy).
  const heartbeatUrl = process.env.OPENROUTER_BUDGET_HEARTBEAT_URL;
  if (heartbeatUrl && (status === "healthy" || status === "warn")) {
    try {
      await fetch(heartbeatUrl, { method: "GET", signal: AbortSignal.timeout(10_000) });
    } catch {
      // A heartbeat-ping failure must not change the budget verdict.
    }
  }

  process.exit(exitCodeFor(status));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((err) => {
    // Exit 0 on an unexpected crash: a bug here must never masquerade as a budget
    // breach (false page). The dead-man monitor catches a silent probe.
    console.error("budget: probe error —", err instanceof Error ? err.message : String(err));
  });
}
