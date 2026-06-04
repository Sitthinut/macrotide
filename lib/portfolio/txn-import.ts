// Transaction-import parsing + normalization — pure, client-safe (no DB, no
// network, no "server-only"), so the Add-transactions sheet and the API route
// share one contract.
//
// A transaction is a buy/sell/dividend/fee/split/reinvest event. The confirmation
// table is the human gate, so parsing is tolerant: it reads what it can and
// flags what the user must fill in.

import { inferQuoteSource } from "@/lib/market/infer-quote-source";
import type { QuoteSource } from "@/lib/market/sources";
import type { TxnKind } from "./lots";

// The DELTA kinds the Activity importer (paste / CSV / image) reads and offers in
// its kind dropdown. Anchors (`opening`/`snapshot`) are NOT here — they are
// created by the Snapshot flow, not typed into a transaction history.
export const TXN_KINDS: readonly TxnKind[] = [
  "buy",
  "sell",
  "dividend",
  "fee",
  "split",
  "reinvest",
] as const;

/** Anchor kinds — absolute position assertions (see ADR 0004). */
export const ANCHOR_KINDS: readonly TxnKind[] = ["opening", "snapshot"] as const;

/** Every valid ledger kind (deltas + anchors). */
export const LEDGER_KINDS: readonly TxnKind[] = [...TXN_KINDS, ...ANCHOR_KINDS] as const;

/** True for any valid stored ledger kind (delta OR anchor). */
export function isTxnKind(v: unknown): v is TxnKind {
  return typeof v === "string" && (LEDGER_KINDS as readonly string[]).includes(v);
}

/** True for a DELTA kind only (excludes anchors) — what the Activity importer accepts. */
export function isDeltaKind(v: unknown): v is TxnKind {
  return typeof v === "string" && (TXN_KINDS as readonly string[]).includes(v);
}

/**
 * Canonical sign for the stored `amount` from a transaction kind. The API
 * receives a POSITIVE magnitude + a kind; the server derives the sign here so a
 * client can never send a sign that disagrees with the kind (which would invert
 * realized-gain / IRR). Cash out is negative, cash in is positive; a split and a
 * snapshot move no cash. A costed `opening` is cash out (the magnitude is the
 * cost put to work); an uncosted opening passes magnitude 0 → a 0 flow.
 */
export function signFor(kind: TxnKind): -1 | 0 | 1 {
  switch (kind) {
    case "buy":
    case "fee":
    case "reinvest":
    case "opening":
      return -1;
    case "sell":
    case "dividend":
      return 1;
    case "split":
    case "snapshot":
      return 0;
  }
}

/** Apply {@link signFor} to a positive magnitude. */
export function signedAmount(kind: TxnKind, magnitude: number): number {
  return signFor(kind) * Math.abs(magnitude);
}

/** A draft row in the editable confirmation table (before save). */
export interface TxnDraftRow {
  /** ISO-8601 date, best-effort; empty string until the user supplies one. */
  tradeDate: string;
  kind: TxnKind;
  ticker: string;
  englishName?: string;
  units: number | null;
  pricePerUnit: number | null;
  /** POSITIVE THB magnitude the user sees; the server applies the sign. */
  amount: number | null;
  fee: number | null;
  quoteSource: QuoteSource;
  /** True when no usable amount could be derived — the user must enter one. */
  needsAmount: boolean;
  /** True when no trade date is present — the user must enter one. */
  needsDate: boolean;
}

/**
 * Loose input to {@link normalizeTxnDraft}: numeric fields accept the raw
 * strings the editable table holds (or numbers from a parser), normalized via
 * coercion. Kept separate from {@link TxnDraftRow} so the table can pass its
 * string state directly.
 */
export interface TxnDraftInput {
  tradeDate?: string;
  kind?: TxnKind | string;
  ticker?: string;
  englishName?: string;
  units?: number | string | null;
  pricePerUnit?: number | string | null;
  amount?: number | string | null;
  fee?: number | string | null;
  quoteSource?: QuoteSource;
}

/**
 * Fill derivable fields and recompute the validation flags for a draft row.
 *  - amount, when blank, is derived as units × price folded with the fee
 *    (buys add the fee to the cash out, sells net it from the cash in);
 *  - a split needs no amount (it moves no cash);
 *  - quoteSource is inferred from the ticker if not pinned.
 */
export function normalizeTxnDraft(row: TxnDraftInput): TxnDraftRow {
  // The Activity importer only deals in deltas; an anchor kind here falls back to
  // a buy (anchors are created by the Snapshot flow, not the transaction table).
  const kind: TxnKind = isDeltaKind(row.kind) ? row.kind : "buy";
  const ticker = (row.ticker ?? "").trim();
  const units = numOrNull(row.units);
  const price = numOrNull(row.pricePerUnit);
  const fee = numOrNull(row.fee);
  let amount = numOrNull(row.amount);

  if (amount === null && units !== null && price !== null && kind !== "split") {
    const gross = Math.abs(units * price);
    const f = fee ?? 0;
    // Cash out on a buy includes the fee; cash in on a sell nets it.
    amount = signFor(kind) < 0 ? gross + f : Math.max(0, gross - f);
  }

  const tradeDate = normalizeDate(row.tradeDate ?? "");
  const quoteSource = row.quoteSource ?? inferQuoteSource(ticker);

  return {
    tradeDate,
    kind,
    ticker,
    englishName: row.englishName?.trim() || undefined,
    units,
    pricePerUnit: price,
    amount,
    fee,
    quoteSource,
    needsAmount: kind !== "split" && (amount === null || amount <= 0),
    needsDate: tradeDate === "",
  };
}

/**
 * Parse pasted text / CSV into draft transaction rows. Tolerant of comma, tab,
 * or whitespace delimiters and an optional header row; columns map by header
 * name when a header is present, else positionally as
 * `date, type, ticker, units, price, amount, fee`. Lines it can't make sense of
 * are skipped — the confirmation table is the final gate.
 */
export function parseTxnPaste(text: string): TxnDraftRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const delim = pickDelimiter(lines[0]);
  const split = (line: string): string[] =>
    delim === "ws" ? line.split(/\s+/) : line.split(delim).map((c) => c.trim());

  // Header detection: first line has a known column word and no obvious numbers.
  const headerCells = split(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = headerCells.some((c) => HEADER_WORDS.has(c)) && !/\d/.test(lines[0]);
  const colMap = hasHeader ? buildColumnMap(headerCells) : null;

  const rows: TxnDraftRow[] = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const cells = split(lines[i]);
    const draft = colMap ? rowFromColumns(cells, colMap) : rowPositional(cells);
    if (draft && draft.ticker) rows.push(normalizeTxnDraft(draft));
  }
  return rows;
}

/**
 * Light-touch heuristic for the snapshot-importer scope-guard: does this set of
 * rows look like a TRANSACTION history rather than a current-holdings snapshot?
 * Two signals — the same ticker repeated across rows (a holdings snapshot has
 * one row per fund), or per-row trade dates. Deliberately conservative: it only
 * nudges the user toward the transaction importer, never blocks.
 */
export function looksLikeTransactionHistory(
  rows: readonly { ticker?: string; tradeDate?: string }[],
): boolean {
  if (rows.length < 3) return false;
  const counts = new Map<string, number>();
  let withDate = 0;
  for (const r of rows) {
    const t = (r.ticker ?? "").trim().toUpperCase();
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    if (r.tradeDate && normalizeDate(r.tradeDate)) withDate++;
  }
  const maxRepeat = Math.max(0, ...counts.values());
  const distinct = counts.size;
  // A ticker appearing 3+ times, OR most rows carrying a date, OR many more rows
  // than distinct funds (repeated trading in a few funds).
  return (
    maxRepeat >= 3 || withDate >= Math.ceil(rows.length / 2) || rows.length >= 2 * distinct + 1
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

const HEADER_WORDS = new Set([
  "date",
  "type",
  "kind",
  "action",
  "side",
  "ticker",
  "symbol",
  "fund",
  "code",
  "units",
  "shares",
  "qty",
  "quantity",
  "price",
  "nav",
  "amount",
  "value",
  "total",
  "fee",
  "commission",
]);

interface ColumnMap {
  date?: number;
  type?: number;
  ticker?: number;
  units?: number;
  price?: number;
  amount?: number;
  fee?: number;
}

function buildColumnMap(header: string[]): ColumnMap {
  const map: ColumnMap = {};
  header.forEach((cell, i) => {
    if (/date/.test(cell)) map.date ??= i;
    else if (/type|kind|action|side/.test(cell)) map.type ??= i;
    else if (/ticker|symbol|fund|code/.test(cell)) map.ticker ??= i;
    else if (/units|shares|qty|quantity/.test(cell)) map.units ??= i;
    else if (/price|nav/.test(cell)) map.price ??= i;
    else if (/amount|value|total/.test(cell)) map.amount ??= i;
    else if (/fee|commission/.test(cell)) map.fee ??= i;
  });
  return map;
}

function rowFromColumns(cells: string[], map: ColumnMap): Partial<TxnDraftRow> | null {
  const at = (i?: number) => (i === undefined ? undefined : cells[i]);
  const ticker = at(map.ticker)?.trim();
  if (!ticker) return null;
  return {
    tradeDate: at(map.date) ?? "",
    kind: parseKind(at(map.type)),
    ticker,
    units: coerce(at(map.units)),
    pricePerUnit: coerce(at(map.price)),
    amount: coerce(at(map.amount)),
    fee: coerce(at(map.fee)),
  };
}

// Positional fallback: pull the date, a kind keyword, a ticker, and up to three
// numbers (units, price, amount) out of the line wherever they sit.
function rowPositional(cells: string[]): Partial<TxnDraftRow> | null {
  let tradeDate = "";
  let kind: TxnKind | undefined;
  let ticker = "";
  const numbers: number[] = [];
  for (const cell of cells) {
    if (!tradeDate && looksLikeDate(cell)) {
      tradeDate = cell;
      continue;
    }
    const k = parseKindLoose(cell);
    if (!kind && k) {
      kind = k;
      continue;
    }
    const n = coerce(cell);
    if (n !== null) {
      numbers.push(n);
      continue;
    }
    if (!ticker && /[A-Za-z]/.test(cell)) ticker = cell.trim();
  }
  if (!ticker) return null;
  const [units, price, amount] = numbers;
  return {
    tradeDate,
    kind: kind ?? "buy",
    ticker,
    units: units ?? null,
    pricePerUnit: price ?? null,
    amount: amount ?? null,
  };
}

function parseKind(v: string | undefined): TxnKind {
  return parseKindLoose(v) ?? "buy";
}

/** Map free-text (incl. Thai broker wording) to a TxnKind, defaulting to "buy". */
export function coerceKind(v: string | undefined): TxnKind {
  return parseKind(v);
}

function parseKindLoose(v: string | undefined): TxnKind | null {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return null;
  // Thai labels (no case) — a switch "สับเปลี่ยน" arrives as its legs: ออก (out) =
  // a sell, เข้า (in) = a buy.
  if (s.includes("ซื้อ") || s.includes("เข้า")) return "buy";
  if (s.includes("ขาย") || s.includes("ออก")) return "sell";
  if (s.includes("ปันผล")) return "dividend";
  if (s.includes("ค่าธรรมเนียม")) return "fee";
  if (/^(buy|bought|purchase|subscribe|subscription|add)/.test(s)) return "buy";
  if (/^(sell|sold|sale|redeem|redemption|withdraw)/.test(s)) return "sell";
  if (/^(reinvest|drip)/.test(s)) return "reinvest";
  if (/^(dividend|distribution|interest|coupon)/.test(s)) return "dividend";
  if (/^(fee|charge|commission|tax)/.test(s)) return "fee";
  if (/^split/.test(s)) return "split";
  return null;
}

function pickDelimiter(line: string): "," | "\t" | "ws" {
  if (line.includes("\t")) return "\t";
  if (line.includes(",")) return ",";
  return "ws";
}

function looksLikeDate(s: string): boolean {
  return /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s) || /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(s);
}

// Thai (Buddhist-era) calendar gap: 2569 พ.ศ. = 2026 ค.ศ.
const BE_OFFSET = 543;

const THAI_MONTHS: Record<string, number> = {
  มกราคม: 1,
  กุมภาพันธ์: 2,
  มีนาคม: 3,
  เมษายน: 4,
  พฤษภาคม: 5,
  มิถุนายน: 6,
  กรกฎาคม: 7,
  สิงหาคม: 8,
  กันยายน: 9,
  ตุลาคม: 10,
  พฤศจิกายน: 11,
  ธันวาคม: 12,
};

/** A year that is clearly Buddhist-era (≥ 2200) folded back to Gregorian. */
function gregorianYear(year: number): number {
  return year >= 2200 ? year - BE_OFFSET : year;
}

const iso = (y: number, m: number, d: number): string =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Best-effort ISO-8601 date (YYYY-MM-DD), or "" if unparseable. Handles Thai
 * month names and Buddhist-era years (e.g. "16 มีนาคม 2569" → "2026-03-16"). */
export function normalizeDate(input: string): string {
  const s = (input ?? "").trim();
  if (!s) return "";

  // Thai "D <month> YYYY" (e.g. "16 มีนาคม 2569"); year is usually Buddhist era.
  for (const [name, month] of Object.entries(THAI_MONTHS)) {
    if (!s.includes(name)) continue;
    const m = s.match(new RegExp(`(\\d{1,2})\\s*${name}\\s*(\\d{4})`));
    if (m) return iso(gregorianYear(Number(m[2])), month, Number(m[1]));
  }

  // Already ISO-ish (YYYY-MM-DD) — fold a Buddhist-era year if present.
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return iso(gregorianYear(Number(isoMatch[1])), Number(isoMatch[2]), Number(isoMatch[3]));
  }
  // D/M/Y — assume day-first (Thai/EU convention) for ambiguous values.
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (dmy[3].length === 2) year += 2000;
    return iso(gregorianYear(year), Number(dmy[2]), Number(dmy[1]));
  }
  return "";
}

function coerce(v: string | undefined): number | null {
  if (v === undefined) return null;
  const cleaned = v.replace(/[฿$,%\s]/g, "").replace(/^\+/, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return coerce(v);
  return null;
}
