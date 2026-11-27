import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { withImportToken } from "@/lib/api/broker-token-auth";
import { readJsonBody } from "@/lib/api/read-json-body";
import { withDb } from "@/lib/api/with-db";
import { getDb } from "@/lib/db/context";
import {
  brokerConnectionKey,
  brokerConnectionKeys,
  resolveAccountBucket,
  setBrokerAccountOrder,
  setBrokerLoginLabel,
  upsertBrokerConnection,
} from "@/lib/db/queries/broker-connections";
import { listBuckets } from "@/lib/db/queries/buckets";
import { canonicalTickerMap, catalogQuoteSource } from "@/lib/db/queries/funds";
import {
  insertTransactionsDeduped,
  remapExternalAccountToBucket,
  type TransactionInsert,
} from "@/lib/db/queries/transactions";
import { tickerKey } from "@/lib/market/sources";
import { parseBrokerExport } from "@/lib/portfolio/broker-import";
import {
  checkSyncLimits,
  MAX_SYNC_BODY_BYTES,
  MAX_USER_BROKER_CONNECTIONS,
} from "@/lib/portfolio/broker-sync-limits";
import { getConnectors } from "@/lib/portfolio/connector";
import type { ExtractedTxnRow } from "@/lib/portfolio/ocr";
import { LEDGER_KINDS, signedAmount } from "@/lib/portfolio/txn-import";

// Confirm-and-commit endpoint for a broker import. Authenticates with EITHER a
// logged-in session OR a broker import token (the userscript path, no cookies);
// accepts the RAW broker export and parses it server-side; routes each broker
// account's orders to its own portfolio (created plan-named on first sight,
// thereafter the user's mapping in Settings → Connections); inserts idempotently
// (re-sync skips orders already in the ledger by external_id) and consolidates
// any earlier rows of that account into the mapped portfolio. Every size limit
// (broker-sync-limits.ts) is checked before the first write, and the writes run
// in one transaction, so a refused or failed sync leaves nothing behind.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEDGER_KIND_SET = new Set<string>(LEDGER_KINDS);

type ValidRow = ExtractedTxnRow & { kind: string; tradeDate: string };

/** An account code as the ledger stores it: a string, or a number's digits.
 *  Anything else (an object, a boolean) isn't a code. */
function accountCode(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/** Plan name per account_code, in the export's own account order. */
function accountNames(exportData: unknown): Map<string, string> {
  const m = new Map<string, string>();
  if (
    exportData &&
    typeof exportData === "object" &&
    Array.isArray((exportData as { accounts?: unknown }).accounts)
  ) {
    for (const a of (exportData as { accounts: unknown[] }).accounts) {
      if (a && typeof a === "object") {
        const code = accountCode((a as { account_code?: unknown }).account_code);
        const name = (a as { name?: unknown }).name;
        if (code !== undefined) m.set(code, typeof name === "string" ? name : "");
      }
    }
  }
  return m;
}

/** Rows with a recognized ledger kind + a DATE-ONLY ISO day. The parser already
 *  drops cancel/pending/unknown and trims datetimes to their date part; this
 *  guards the kind→column and date-only contracts, since this route bypasses the
 *  /api/transactions Zod boundary and a stored datetime breaks every date-only
 *  fold downstream. */
function validRows(rows: ExtractedTxnRow[]): ValidRow[] {
  return rows.filter(
    (r): r is ValidRow =>
      !!r.tradeDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(r.tradeDate) &&
      !!r.kind &&
      LEDGER_KIND_SET.has(r.kind),
  );
}

/** Group by broker account; rows with no account (bare-array shape) share `""`. */
function groupByAccount(valid: ValidRow[]): Map<string, ValidRow[]> {
  const groups = new Map<string, ValidRow[]>();
  for (const r of valid) {
    const key = r.externalAccount ?? "";
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  return groups;
}

/** The 400 for a sync that would add connections past the per-user limit, or
 *  null. Only accounts new to this user count, so syncing accounts already
 *  linked always works. Runs inside a DB context. */
function connectionLimitError(sourceTag: string, accounts: Iterable<string>): NextResponse | null {
  const existing = brokerConnectionKeys();
  let added = 0;
  for (const a of accounts) {
    if (a && !existing.has(brokerConnectionKey(sourceTag, a))) added++;
  }
  if (added === 0 || existing.size + added <= MAX_USER_BROKER_CONNECTIONS) return null;
  return NextResponse.json(
    {
      error: "account_limit",
      message: `This sync would link more than ${MAX_USER_BROKER_CONNECTIONS} broker accounts. Unlink accounts you no longer use in Settings, then sync again.`,
    },
    { status: 400 },
  );
}

/** Map parsed broker rows for ONE bucket into ledger inserts. */
function toInsertRows(
  rows: ValidRow[],
  bucketId: string,
  sourceLabel: string,
  catalogSources: Map<string, string>,
  canon: Map<string, string>,
  importBatchId: string,
): TransactionInsert[] {
  return rows.map((r) => {
    // Store the official catalog case (#235); a custom symbol keeps the typed case.
    const ticker = canon.get(tickerKey(r.ticker)) ?? r.ticker.trim();
    const catalogSource = catalogSources.get(tickerKey(ticker));
    const quoteSource = catalogSource === "thai_mutual_fund" ? catalogSource : "market";
    // r.kind is gated by LEDGER_KIND_SET in commit(), so it's a valid ledger kind.
    const kind = r.kind as (typeof LEDGER_KINDS)[number];
    return {
      bucketId,
      ticker,
      englishName: r.englishName ?? null,
      quoteSource,
      // Broker history is real trades (buy/sell/dividend) — never balance anchors.
      kind,
      tradeDate: r.tradeDate,
      units: r.units ?? null,
      value: null,
      pricePerUnit: r.pricePerUnit ?? null,
      marketPrice: r.pricePerUnit ?? null,
      amount: signedAmount(kind, r.amount ?? 0),
      fee: r.fee ?? null,
      tradeCurrency: "THB",
      fxToThb: 1,
      note: null,
      // Human-readable provenance shown on holdings (the broker's display name),
      // not the internal sourceTag.
      source: sourceLabel,
      importBatchId,
      externalId: r.externalId ?? null,
      externalAccount: r.externalAccount ?? null,
    };
  });
}

interface AccountResult {
  account: string | null;
  bucketId: string;
  inserted: number;
  skipped: number;
}

/** Route + insert per broker account. Runs inside a DB context and transaction. */
function commit(
  valid: ValidRow[],
  groups: Map<string, ValidRow[]>,
  sourceTag: string,
  sourceLabel: string,
  names: Map<string, string>,
  fallbackBucketId: string | undefined,
  accountLabel: string,
): NextResponse {
  const owned = listBuckets();
  // Rows with no account context (bare array) → a chosen/first portfolio.
  const fallback =
    (fallbackBucketId && owned.find((b) => b.id === fallbackBucketId)?.id) || owned[0]?.id;
  // Nothing to route → refuse before saving anything. A real account always
  // routes (its portfolio is created if missing).
  const routable = [...groups.keys()].some((account) => account !== "" || !!fallback);
  if (!routable) {
    return NextResponse.json(
      { error: "no_bucket", message: "No importable orders, or no portfolio to route to." },
      { status: 409 },
    );
  }

  // Remember the broker-login identifier (name/email) for the Settings header.
  if (accountLabel) setBrokerLoginLabel(sourceTag, accountLabel);
  // Remember the broker's account order (as the export listed them) so the
  // Connections list sorts the same way as the source, not by account code.
  if (names.size) setBrokerAccountOrder(sourceTag, Array.from(names.keys()));

  let ownedIds = owned.map((b) => b.id);
  const catalogSources = catalogQuoteSource(valid.map((r) => r.ticker));
  const canon = canonicalTickerMap(valid.map((r) => r.ticker));
  const importBatchId = randomUUID();
  const now = new Date().toISOString();

  let totalInserted = 0;
  let totalSkipped = 0;
  const results: AccountResult[] = [];

  for (const [account, groupRows] of groups) {
    let bucketId: string;
    if (account) {
      // Real broker account → its mapped portfolio (created plan-named if new).
      bucketId = resolveAccountBucket(sourceTag, account, names.get(account) ?? "").bucketId;
      if (!ownedIds.includes(bucketId)) ownedIds = [...ownedIds, bucketId];
      // Pull any earlier rows of this account into the mapped portfolio.
      remapExternalAccountToBucket(sourceTag, account, bucketId, ownedIds);
    } else {
      if (!fallback) continue; // no portfolio at all → nothing to route to
      bucketId = fallback;
    }

    const insertRows = toInsertRows(
      groupRows,
      bucketId,
      sourceLabel,
      catalogSources,
      canon,
      importBatchId,
    );
    const { inserted, skipped } = insertTransactionsDeduped(insertRows);
    totalInserted += inserted.length;
    totalSkipped += skipped;
    results.push({ account: account || null, bucketId, inserted: inserted.length, skipped });

    if (account) {
      upsertBrokerConnection({
        source: sourceTag,
        accountCode: account,
        displayName: names.get(account) ?? null,
        bucketId,
        lastSyncedAt: now,
        lastInserted: inserted.length,
        lastSkipped: skipped,
      });
    }
  }

  return NextResponse.json(
    { inserted: totalInserted, skipped: totalSkipped, importBatchId, accounts: results },
    { status: 201 },
  );
}

export async function POST(req: Request) {
  const headerToken = req.headers.get("x-import-token")?.trim() ?? "";

  const body = await readJsonBody(req, MAX_SYNC_BODY_BYTES);
  if (!body.ok) {
    return body.reason === "too_large"
      ? NextResponse.json(
          {
            error: "payload_too_large",
            message: `A sync can be at most ${MAX_SYNC_BODY_BYTES / (1024 * 1024)} MB.`,
          },
          { status: 413 },
        )
      : NextResponse.json(
          { error: "bad_request", message: "Expected a JSON body." },
          { status: 400 },
        );
  }
  const raw = body.value;

  // Body is the raw broker export; a thin optional envelope can carry an explicit
  // fallback bucket / token: { payload, bucketId, token }.
  const env = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
  const exportData = env && "payload" in env ? env.payload : raw;
  const fallbackBucketId = typeof env?.bucketId === "string" ? env.bucketId : undefined;
  const bodyToken = typeof env?.token === "string" ? env.token : "";
  const token = headerToken || bodyToken;

  // The export names its broker via `source` (the connector's sourceTag) — match
  // it to the right connector so the correct response-shape drives parsing (with
  // several connectors configured). An export without one falls back to the
  // first connector, then SDK defaults.
  const exportSource =
    exportData &&
    typeof exportData === "object" &&
    typeof (exportData as { source?: unknown }).source === "string"
      ? (exportData as { source: string }).source.trim() || undefined
      : undefined;
  const connectors = await getConnectors();
  const matched = exportSource ? connectors.find((c) => c.sourceTag === exportSource) : undefined;
  // The source keys per-user settings rows, so only a configured connector's
  // tag is accepted. Checked after authentication so an anonymous caller can't
  // probe which brokers are configured.
  const unknownSource = exportSource !== undefined && !matched;
  const connector = matched ?? connectors[0] ?? null;
  const parsed = parseBrokerExport(exportData, connector?.shape);
  // The parser copies each account's code onto its rows as-is; normalize it the
  // same way as the account list, and refuse a code that isn't one.
  let badAccount = false;
  const rows = parsed.rows.map((r) => {
    if (r.externalAccount === undefined) return r;
    const code = accountCode(r.externalAccount);
    if (code === undefined) badAccount = true;
    return { ...r, externalAccount: code };
  });
  if (badAccount) {
    return NextResponse.json(
      { error: "bad_request", message: "A broker account code must be text or a number." },
      { status: 400 },
    );
  }
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "no_rows", message: "No importable orders in that export." },
      { status: 400 },
    );
  }
  const sourceTag = exportSource ?? "broker";
  // Human-readable provenance for the holdings' source label (the broker's
  // display name); the sourceTag stays the routing/dedup key.
  const sourceLabel = connector?.displayName?.trim() || sourceTag;
  const names = accountNames(exportData);
  const accountLabel =
    exportData &&
    typeof exportData === "object" &&
    typeof (exportData as { accountLabel?: unknown }).accountLabel === "string"
      ? (exportData as { accountLabel: string }).accountLabel
      : "";

  const valid = validRows(rows);
  const groups = groupByAccount(valid);

  const run = () => {
    if (!unknownSource) {
      const limit = checkSyncLimits({
        listedAccounts: Array.from(names.keys()),
        names,
        rowAccounts: Array.from(groups.keys()).filter(Boolean),
        accountLabel,
        rows,
      });
      if (limit) return NextResponse.json(limit, { status: 400 });
      return getDb().transaction(
        () =>
          connectionLimitError(sourceTag, groups.keys()) ??
          commit(valid, groups, sourceTag, sourceLabel, names, fallbackBucketId, accountLabel),
      );
    }
    // No connector at all usually means the manifest couldn't be loaded right
    // now, so the sync is worth retrying; a list without this tag is final.
    return connectors.length === 0
      ? NextResponse.json(
          { error: "broker_unavailable", message: "Broker sync isn't available right now." },
          { status: 503 },
        )
      : NextResponse.json(
          { error: "unknown_source", message: "That broker isn't configured on this server." },
          { status: 400 },
        );
  };

  // Token path (the userscript): no cookies; the token authenticates + resolves
  // the owner. Falls through to session auth when no token is supplied.
  if (token) {
    const res = await withImportToken(token, run);
    if (!res.ok) return NextResponse.json({ error: "invalid_token" }, { status: 401 });
    return res.value;
  }

  return withDb(run);
}
