"use client";

// RecordSheet — the unified "Add to portfolio". ONE surface for both a current-
// holdings snapshot (Starting-balance rows → opening anchors) and buy/sell
// activity (trade rows → ledger deltas). There is NO holdings/history mode: the
// kind lives PER ROW (a Type) and is auto-detected from pasted/imported data —
// the same model Maybe Finance (Valuation vs Trade), Beancount (opening-balance
// vs trade), and Fava's per-type add modal all converge on.
//
// Layout: one calm intake (paste / screenshot / + add row) → a review LIST of
// native holdings-style rows, each tappable into the inline `.rec-edit` editor
// whose Type dropdown spans Starting balance + every trade kind and reshapes the
// fields. Narrow modal on desktop / full-bleed bottom sheet on mobile (the Modal
// primitive); the `.rec-edit` grid stacks on narrow, so no wide modal needed.

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { SymbolCombobox } from "@/components/portfolio/SymbolCombobox";
import { Combobox } from "@/components/ui/Combobox";
import { QtyInput } from "@/components/ui/QtyInput";
import { mergeWithHoldings, type TickerSuggestion } from "@/lib/data/known-holdings";
import { mergeSourceSuggestions } from "@/lib/data/sources";
import { useBuckets, useHoldings } from "@/lib/fetchers/portfolio";
import { invalidate } from "@/lib/fetchers/swr";
import { normalizeImage } from "@/lib/image-normalize";
import type { QuoteSource } from "@/lib/market/sources";
import type { TxnKind } from "@/lib/portfolio/lots";
import type { ExtractedTxnRow, ImportDocType } from "@/lib/portfolio/ocr";
import { TXN_KIND_HELP, TXN_KIND_LABEL, typeSelectOptions } from "@/lib/portfolio/txn-display";
import { normalizeDate, normalizeTxnDraft, parseTxnPaste } from "@/lib/portfolio/txn-import";
import type { ImportSeedRow } from "@/lib/stores/import-seed";

// "opening" is the Starting balance (snapshot anchor); the rest are trade deltas.
type RowKind = TxnKind;

// Verb-first label for the collapsed row. Both anchors read as "Balance".
const VERB: Record<RowKind, string> = {
  opening: "Balance",
  snapshot: "Balance",
  buy: "Bought",
  sell: "Sold",
  dividend: "Dividend",
  fee: "Fee",
  split: "Split",
  reinvest: "Reinvested",
};

const ABBR: Record<RowKind, string> = {
  opening: "BAL",
  snapshot: "BAL",
  buy: "BUY",
  sell: "SELL",
  dividend: "DIV",
  fee: "FEE",
  split: "SPL",
  reinvest: "RE",
};

const TONE: Record<RowKind, string> = {
  opening: "var(--amber)",
  buy: "var(--accent)",
  sell: "var(--loss)",
  dividend: "var(--accent-2)",
  reinvest: "var(--accent-2)",
  fee: "var(--muted-2)",
  split: "var(--muted-2)",
  snapshot: "var(--amber)",
};

const isAnchor = (k: RowKind): boolean => k === "opening" || k === "snapshot";
const baht = (n: number): string => `฿${Math.round(n).toLocaleString("en-US")}`;
// "2026-06-05" → "Jun 5, 2026" (no leading zero). Raw string back if not ISO.
const fmtDate = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
};
const numFmt = (s: string): string => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : s;
};

interface Row {
  id: number;
  kind: RowKind;
  tradeDate: string;
  ticker: string;
  englishName?: string;
  units: string;
  price: string; // price/unit (trade) OR avg cost (anchor)
  /** A Balance's current market price per unit — used to value a custom asset
   * that has no live NAV. Empty for trades (their price doubles as the market). */
  currentPrice?: string;
  /** A Balance's stated current ฿ VALUE when the source shows value not units
   * (Thai-app case). Units are derived from value ÷ NAV(date) at save (#130) —
   * carried here so a value-only row persists and reaches the server. */
  value?: string;
  /** A value-only Balance's invested ฿ cost-basis TOTAL (a fact, when the source
   * shows it). Sent as the ledger `amount` magnitude so the cost reaches XIRR; the
   * per-unit avg cost derives from it ÷ units at the fold — never frozen here. */
  costTotal?: string;
  /** True when units/avg-cost were DERIVED from a value (not read) — the editor
   * marks those fields estimated so the user knows to verify. */
  estimated?: boolean;
  fee: string;
  amount: string;
  quoteSource?: QuoteSource;
  /** True once the user explicitly flips the price-source badge — pins the badge
   * highlight and stops a ticker edit from re-inferring over the choice. */
  quoteSourceLocked?: boolean;
  /** Origin — paste rows are owned by the textbox (re-derived on "Update
   * table"); manual / image rows are independent and survive a re-parse. */
  provenance?: "paste" | "manual" | "image";
}

const today = (): string => new Date().toISOString().slice(0, 10);

let nextId = 1;
const blankRow = (kind: RowKind): Row => ({
  id: nextId++,
  kind,
  // A Balance defaults to today (as-of now); a trade leaves the date blank to fill.
  tradeDate: isAnchor(kind) ? today() : "",
  ticker: "",
  units: "",
  price: "",
  fee: "",
  amount: "",
  provenance: "manual",
});

// An untouched manual row (e.g. the default row on open) — no fund or numbers
// typed. Dropped once real rows arrive from paste/import so it isn't left dangling.
const isBlankManual = (r: Row): boolean =>
  r.provenance === "manual" &&
  !r.ticker.trim() &&
  !r.units.trim() &&
  !r.price.trim() &&
  !r.amount.trim() &&
  !r.fee.trim();

// Map a pasted draft → a Row. A row with no trade date is read as a Starting
// balance (the snapshot case); a dated row keeps its detected trade kind.
function draftToRow(d: ReturnType<typeof parseTxnPaste>[number]): Row {
  const kind: RowKind = d.tradeDate ? d.kind : "opening";
  return {
    id: nextId++,
    kind,
    tradeDate: d.tradeDate,
    ticker: d.ticker,
    englishName: d.englishName,
    units: d.units != null ? String(d.units) : "",
    price: d.pricePerUnit != null ? String(d.pricePerUnit) : "",
    fee: d.fee != null ? String(d.fee) : "",
    amount: d.amount != null ? String(d.amount) : "",
    quoteSource: d.quoteSource,
    provenance: "paste",
  };
}

// Map an OCR'd holdings row (snapshot screenshot) → a Starting-balance Row.
// `asOf` is the snapshot date (from the file). Units READ off the source make a
// units row; units DERIVED from a ฿ value (s.estimated — the Thai-app case) make a
// VALUE-driven row: the Balance opens in ฿ mode showing the figure the user
// recognises, and the server re-derives units from NAV(asOf) at save (#130) — we
// don't headline a 5-decimal unit count nobody typed.
function seedHoldingToRow(s: ImportSeedRow, asOf = ""): Row {
  const readUnits = s.estimated !== true && s.units != null ? String(s.units) : "";
  return {
    id: nextId++,
    kind: "opening",
    // The Add-modal path passes `asOf`; the Advisor path stamps it on the row.
    tradeDate: asOf || s.asOf || "",
    ticker: s.ticker,
    englishName: s.englishName,
    units: readUnits,
    // Seed an avg cost ONLY when it's a real per-unit figure read off the source —
    // never a derived estimate (a value-only row's per-unit cost is derived at the
    // fold from costTotal ÷ units, not frozen). The invested TOTAL rides on costTotal.
    price: s.estimated !== true && s.avgCost != null ? String(s.avgCost) : "",
    // Carry the ฿ value whenever units aren't shown (a derived or no-NAV row).
    value: readUnits === "" && s.value != null ? String(s.value) : "",
    costTotal: s.costTotal != null ? String(s.costTotal) : "",
    estimated: s.estimated,
    fee: "",
    amount: "",
    quoteSource: s.quoteSource ?? "manual",
    provenance: "image",
  };
}

function seedTxnToRow(e: ExtractedTxnRow, asOf = ""): Row {
  // Trades carry their own dated rows; fall back to the file date only if absent.
  const tradeDate = normalizeDate(e.tradeDate ?? "") || asOf;
  return {
    id: nextId++,
    kind: tradeDate ? ((e.kind as RowKind) ?? "buy") : "opening",
    tradeDate,
    ticker: e.ticker,
    englishName: e.englishName,
    units: e.units != null ? String(e.units) : "",
    price: e.pricePerUnit != null ? String(e.pricePerUnit) : "",
    fee: e.fee != null ? String(e.fee) : "",
    amount: e.amount != null ? String(e.amount) : "",
    quoteSource: "manual",
    provenance: "image",
  };
}

export interface RecordSheetProps {
  open: boolean;
  onClose: () => void;
  onSaved?: (count: number) => void;
  defaultBucketId?: string | null;
  /** "opening" when entered from Holdings "Add"; "buy" from a Record action. */
  defaultKind?: RowKind;
  /** Rows seeded from the Advisor's in-chat holdings table (→ Starting balances). */
  holdingsSeed?: ImportSeedRow[] | null;
  /** Rows seeded from a handoff (→ activity). */
  txnSeed?: ExtractedTxnRow[] | null;
}

export function RecordSheet({
  open,
  onClose,
  onSaved,
  defaultBucketId,
  defaultKind = "opening",
  holdingsSeed,
  txnSeed,
}: RecordSheetProps) {
  const { data: buckets } = useBuckets();
  const { data: holdings } = useHoldings();
  const [bucketId, setBucketId] = useState("");
  const [source, setSource] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [imgBusy, setImgBusy] = useState(false);
  // Set when an imported screenshot's type (snapshot vs history) was a
  // low-confidence guess — drives the "switch type?" confirm banner. Carries the
  // model's as-of date so a re-read keeps it (the override path skips detection).
  const [unsure, setUnsure] = useState<{
    file: File;
    guessed: ImportDocType;
    asOf: string;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && !bucketId) setBucketId(defaultBucketId || buckets?.[0]?.id || "");
  }, [open, bucketId, defaultBucketId, buckets]);

  // Consume seeds once per open.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) return;
    const seeded: Row[] = [];
    if (holdingsSeed?.length) seeded.push(...holdingsSeed.map((s) => seedHoldingToRow(s)));
    if (txnSeed?.length) seeded.push(...txnSeed.map((e) => seedTxnToRow(e)));
    if (seeded.length) {
      seededRef.current = true;
      setRows(seeded);
    }
  }, [open, holdingsSeed, txnSeed]);

  // On open with no seeds, start with ONE editable row (opened in the editor) so
  // the modal is immediately usable instead of blank. Runs on the open transition
  // only; a fresh open also clears a previous, cancelled session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open-transition only
  useEffect(() => {
    if (!open || holdingsSeed?.length || txnSeed?.length) return;
    const r = blankRow(defaultKind === "opening" ? "opening" : "buy");
    setRows([r]);
    setEditing(r.id);
    setPasteText("");
    setError(null);
  }, [open]);

  const sourceOptions = useMemo(
    () => mergeSourceSuggestions((holdings ?? []).map((h) => h.source)),
    [holdings],
  );
  // Substring-filtered source suggestions for the custom combobox (the native
  // datalist filtered itself; this one does it explicitly).
  const sourceItems = useMemo(() => {
    const q = source.trim().toLowerCase();
    const base = q ? sourceOptions.filter((s) => s.toLowerCase().includes(q)) : sourceOptions;
    return base.slice(0, 8);
  }, [source, sourceOptions]);
  const tickerOptions = useMemo<TickerSuggestion[]>(
    () =>
      mergeWithHoldings(
        (holdings ?? []).map((h) => ({
          ticker: h.ticker,
          englishName: h.englishName,
          quoteSource: h.quoteSource,
        })),
      ).slice(0, 200),
    [holdings],
  );

  const reset = () => {
    setRows([]);
    setEditing(null);
    setPasteText("");
    setError(null);
    setUnsure(null);
  };

  // Re-derive the PASTE rows from the textbox, leaving manual/image rows intact.
  // The textbox owns its rows: editing it + "Update table" updates/replaces/
  // deletes only those (manual rows are independent).
  const syncPasteRows = (text: string) => {
    const drafts = parseTxnPaste(text).filter((d) => d.ticker.trim());
    if (drafts.length === 0) {
      if (text.trim())
        setError("Couldn't read any rows — one entry per line (e.g. EXAMPLE-FUND-A, 100, 25.00).");
      setRows((prev) => prev.filter((r) => r.provenance !== "paste"));
      return;
    }
    setError(null);
    // Real rows arrived → drop the untouched default/blank manual row and collapse
    // any open editor, so the review list shows what was pasted, not an empty stub.
    setEditing(null);
    setRows((prev) => [
      ...prev.filter((r) => r.provenance !== "paste" && !isBlankManual(r)),
      ...drafts.map(draftToRow),
    ]);
  };

  // Ingest dropped/chosen files — screenshots (OCR → Starting balances) and
  // CSV/text (parsed → detected rows). Multiple files at once.
  // Read one screenshot. The endpoint auto-detects holdings-snapshot (→ Starting
  // balances) vs transaction-history (→ trade rows) and returns the matching rows
  // plus a confidence; `as` forces a type when the user resolves a low-confidence
  // guess via the banner.
  const importFile = async (
    file: File,
    as?: ImportDocType,
    asOfHint = "",
  ): Promise<{ rows: Row[]; docType: ImportDocType; confidence: "high" | "low"; asOf: string }> => {
    const fd = new FormData();
    // Normalize to the shared 2048/0.8 JPEG so the OCR pipeline gets the same
    // image the Advisor does (same model) — bounds upload + tile cost, keeps the
    // resolution the model needs to read dense tables.
    const norm = await normalizeImage(file);
    fd.append("image", norm.blob, file.name);
    // Filename + saved-at ride as CONTEXT for the model's as-of-date call (a
    // date shown in the image wins; we never parse the filename ourselves).
    fd.append("filename", file.name);
    if (file.lastModified) fd.append("capturedAt", new Date(file.lastModified).toISOString());
    if (as) fd.append("as", as);
    const res = await fetch("/api/import/image", { method: "POST", body: fd });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as {
      docType: ImportDocType;
      confidence: "high" | "low";
      asOf?: string | null;
      holdings?: ImportSeedRow[];
      transactions?: ExtractedTxnRow[];
    };
    // The override path skips classification (no asOf) — re-use the date the
    // first read found.
    const asOf = body.asOf ?? asOfHint;
    const rows =
      body.docType === "transactions"
        ? (body.transactions ?? [])
            .filter((r) => r.ticker?.trim())
            .map((r) => seedTxnToRow(r, asOf))
        : (body.holdings ?? [])
            .filter((r) => r.ticker?.trim())
            .map((r) => seedHoldingToRow(r, asOf));
    return { rows, docType: body.docType, confidence: body.confidence, asOf };
  };
  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setImgBusy(true);
    setError(null);
    setUnsure(null);
    try {
      const collected: Row[] = [];
      let unsureFile: { file: File; guessed: ImportDocType; asOf: string } | null = null;
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          const det = await importFile(file);
          collected.push(...det.rows);
          if (det.confidence === "low" && det.rows.length) {
            unsureFile = { file, guessed: det.docType, asOf: det.asOf };
          }
        } else {
          collected.push(
            ...parseTxnPaste(await file.text())
              .filter((d) => d.ticker.trim())
              .map(draftToRow),
          );
        }
      }
      if (collected.length) {
        setEditing(null);
        setRows((prev) => [...prev.filter((r) => !isBlankManual(r)), ...collected]);
        setUnsure(unsureFile);
      } else setError("Couldn't read those files. Try a sharper screenshot, or paste the rows.");
    } catch {
      setError("Couldn't read those files. Try a sharper screenshot, or paste the rows.");
    } finally {
      setImgBusy(false);
    }
  };
  // Re-read the unsure image as the OTHER type and swap in those rows.
  const switchImportType = async () => {
    if (!unsure) return;
    const other: ImportDocType = unsure.guessed === "transactions" ? "holdings" : "transactions";
    setImgBusy(true);
    setError(null);
    try {
      const det = await importFile(unsure.file, other, unsure.asOf);
      setRows((prev) => [...prev.filter((r) => r.provenance !== "image"), ...det.rows]);
      setUnsure(null);
    } catch {
      setError("Couldn't re-read that image. Try pasting the rows instead.");
    } finally {
      setImgBusy(false);
    }
  };
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void handleFiles(files);
  };

  const addManual = () => {
    const kind: RowKind = (holdings?.length ?? 0) > 0 ? defaultKind : "opening";
    const r = blankRow(kind === "opening" ? "opening" : "buy");
    setRows((prev) => [...prev, r]);
    setEditing(r.id);
  };

  // Resolve each row's price source against the REAL fund catalog (a catalog fund →
  // "Fund", a market-shaped code → "Stock/ETF", else custom) so the badge is right
  // on the fly for ANY typed/imported symbol — not just the client seed list the
  // shape heuristic falls back to. Skips rows the user pinned; debounced + cached so
  // it fires once per new symbol and converges (only patches when the source differs).
  const sourceCache = useRef(new Map<string, QuoteSource>());
  useEffect(() => {
    const applyCached = () =>
      setRows((prev) => {
        let changed = false;
        const next = prev.map((r) => {
          if (r.quoteSourceLocked || !r.ticker.trim()) return r;
          const resolved = sourceCache.current.get(r.ticker.trim().toUpperCase());
          if (resolved && resolved !== r.quoteSource) {
            changed = true;
            return { ...r, quoteSource: resolved };
          }
          return r;
        });
        return changed ? next : prev;
      });

    const pending = [
      ...new Set(
        rows
          .filter((r) => r.ticker.trim() && !r.quoteSourceLocked)
          .map((r) => r.ticker.trim().toUpperCase())
          .filter((t) => !sourceCache.current.has(t)),
      ),
    ];
    if (pending.length === 0) {
      applyCached();
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/quote-source?tickers=${encodeURIComponent(pending.join(","))}`,
        );
        if (!res.ok) return;
        const map = (await res.json()) as Record<string, QuoteSource>;
        for (const [t, s] of Object.entries(map)) sourceCache.current.set(t.toUpperCase(), s);
        applyCached();
      } catch {
        // Best-effort — on failure the shape-heuristic default badge stands.
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [rows]);

  const patch = (id: number, p: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const removeRow = (id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (editing === id) setEditing(null);
  };

  const valid = (r: Row): boolean => {
    if (!r.ticker.trim()) return false;
    // A Balance is ready with either a unit count OR a stated ฿ value — the server
    // derives units from value ÷ NAV(date) when only the value is given (#130).
    if (isAnchor(r.kind)) return Number(r.units) > 0 || Number(r.value) > 0;
    const d = normalizeTxnDraft({
      tradeDate: r.tradeDate,
      kind: r.kind,
      ticker: r.ticker,
      units: r.units,
      pricePerUnit: r.price,
      amount: r.amount,
      fee: r.fee,
    });
    return !!d.ticker && !d.needsDate && (d.kind === "split" ? d.units != null : !d.needsAmount);
  };
  const readyRows = rows.filter(valid);

  const submit = async () => {
    if (!bucketId) {
      setError("Pick a portfolio first.");
      return;
    }
    if (readyRows.length === 0) {
      setError("Nothing ready to save yet — fill in at least one row.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const transactions = readyRows.map((r) => {
        const quoteSource = r.quoteSource || "manual";
        if (isAnchor(r.kind)) {
          const hasUnits = Number(r.units) > 0;
          const avg = r.price.trim() === "" ? null : Number(r.price);
          // Persist a per-unit avg cost only when it's a real (read/typed) figure —
          // never a derived estimate, which would freeze a NAV-dependent number
          // (facts-only, ADR 0004). A value-only row's per-unit cost derives at the fold.
          const realAvg = r.estimated ? null : avg;
          // The cost magnitude (positive) for the ledger `amount`; the server signs it
          // (opening = cash out, a restatement = 0) so a costed opening reaches XIRR.
          // Units read → from the real avg cost; value-only → the invested total.
          const costMagnitude =
            hasUnits && realAvg != null
              ? Number(r.units) * realAvg
              : Number(r.costTotal) > 0
                ? Number(r.costTotal)
                : 0;
          return {
            tradeDate: r.tradeDate || new Date().toISOString().slice(0, 10),
            kind: r.kind,
            ticker: r.ticker.trim().toUpperCase(),
            englishName: r.englishName,
            // Send units when read; otherwise omit and send the ฿ value so the
            // server derives units from NAV(tradeDate) (#130).
            units: hasUnits ? Number(r.units) : undefined,
            value: !hasUnits && Number(r.value) > 0 ? Number(r.value) : undefined,
            pricePerUnit: realAvg,
            // The Balance's current price → the asset's market-price point.
            marketPrice: r.currentPrice?.trim() ? Number(r.currentPrice) : undefined,
            amount: costMagnitude,
            quoteSource,
            source: source.trim() || undefined,
          };
        }
        const d = normalizeTxnDraft({
          tradeDate: r.tradeDate,
          kind: r.kind,
          ticker: r.ticker,
          units: r.units,
          pricePerUnit: r.price,
          amount: r.amount,
          fee: r.fee,
        });
        return {
          tradeDate: d.tradeDate,
          kind: d.kind,
          ticker: d.ticker.toUpperCase(),
          englishName: r.englishName,
          units: d.units,
          pricePerUnit: d.pricePerUnit,
          fee: d.fee,
          amount: d.kind === "split" ? 0 : (d.amount ?? 0),
          quoteSource: d.quoteSource || quoteSource,
          source: source.trim() || undefined,
        };
      });
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bucketId, transactions }),
      });
      // Facts-only ledger (ADR 0004): a value-only Balance always saves — even with no
      // NAV on its date yet — storing the ฿ value as the fact; its units derive at the
      // fold when that date's NAV lands. So there's no "couldn't price it" reject here.
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { count: number };
      invalidate(/^\/api\/transactions/);
      invalidate(/^\/api\/holdings/);
      invalidate(/^\/api\/portfolios/);
      onSaved?.(body.count);
      reset();
      onClose();
    } catch {
      setError("Couldn't save. Check the values and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const hasRows = rows.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="form"
      className="modal--txnwide"
      labelledBy="rec-title"
    >
      <Modal.Header
        title="Add to portfolio"
        subtitle="Paste, snap a screenshot, or add a row. We sort out what's a holding and what's a trade — change any row's type below."
        id="rec-title"
      />
      <Modal.Body gap={12}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label className="rec-field">
            <span className="rec-field__label">PORTFOLIO</span>
            <select
              className="sheet-input"
              value={bucketId}
              onChange={(e) => setBucketId(e.target.value)}
            >
              {(buckets ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="rec-field">
            <span className="rec-field__label">SOURCE</span>
            <Combobox<string>
              value={source}
              onChange={setSource}
              onPick={(s) => setSource(s)}
              items={sourceItems}
              getKey={(s) => s}
              renderItem={(s) => s}
              label="Source"
              placeholder="Broker (optional)"
              inputClassName="sheet-input"
            />
          </label>
        </div>

        {/* One intake — no mode segment. Paste, drop screenshots/CSV, or add a row. */}
        <div
          className="rec-intake"
          data-drag={dragOver || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFiles(Array.from(e.dataTransfer.files ?? []));
          }}
        >
          <div className="rec-paste">
            <textarea
              rows={5}
              placeholder={
                "Paste your holdings or a buy/sell log — one per line.\nEXAMPLE-FUND-A, 100, 25.00\n2024-03-12, Buy, K-EQUITY, 50, 18.40, 920\n\nOr drop screenshots / a CSV here."
              }
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              onPaste={(e) => {
                // Auto-parse on paste — rows appear immediately, AND the raw text
                // stays so you can edit it and re-sync with Apply.
                const pasted = e.clipboardData.getData("text");
                if (!pasted.trim()) return;
                const t = e.currentTarget;
                const start = t.selectionStart ?? t.value.length;
                const end = t.selectionEnd ?? t.value.length;
                const next = t.value.slice(0, start) + pasted + t.value.slice(end);
                e.preventDefault();
                setPasteText(next);
                syncPasteRows(next);
              }}
            />
          </div>
          <div className="rec-intake__actions">
            {/* Apply sits to the LEFT of Images/CSV and only appears once there's
                text to read — so it never floats over the box or shifts its height. */}
            {pasteText.trim() && (
              <button
                type="button"
                className="btn primary sm"
                onClick={() => syncPasteRows(pasteText)}
                title="Read the rows from this text"
              >
                Apply
              </button>
            )}
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => fileRef.current?.click()}
              disabled={imgBusy}
            >
              <Icon name="chart" size={12} /> {imgBusy ? "Reading…" : "Images / CSV"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,.csv,.txt,text/csv,text/plain"
              multiple
              hidden
              onChange={onFileInput}
            />
          </div>
        </div>

        {error && <div className="rec-error">{error}</div>}
        {unsure && (
          <div className="rec-ask">
            <span>
              Read this as{" "}
              <strong>
                {unsure.guessed === "transactions"
                  ? "a transaction history"
                  : "a holdings snapshot"}
              </strong>{" "}
              — not certain.
            </span>
            <button
              type="button"
              className="btn ghost sm"
              onClick={switchImportType}
              disabled={imgBusy}
            >
              Switch to {unsure.guessed === "transactions" ? "holdings" : "transactions"}
            </button>
          </div>
        )}

        {/* Review list — native holdings-style rows; tap to edit. */}
        {hasRows && (
          <div className="holdings-list" style={{ padding: 0 }}>
            {rows.map((r) =>
              editing === r.id ? (
                <RowEditor
                  key={r.id}
                  row={r}
                  tickers={tickerOptions}
                  onChange={(p) => patch(r.id, p)}
                  onDone={() => setEditing(null)}
                  onRemove={() => removeRow(r.id)}
                />
              ) : (
                <DraftRow
                  key={r.id}
                  row={r}
                  onEdit={() => setEditing(r.id)}
                  onRemove={() => removeRow(r.id)}
                />
              ),
            )}
          </div>
        )}

        <button type="button" className="rec-add-row" onClick={addManual}>
          <Icon name="plus" size={13} /> Add a row
        </button>

        <p className="rec-hint">
          <Icon name="sparkle" size={12} /> Or tell Advisor in chat — e.g. “Add ฿50k of K-FIXED-A
          from SCB.” It confirms before saving.
        </p>
      </Modal.Body>
      <Modal.Footer
        start={
          hasRows ? (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{readyRows.length} ready</span>
          ) : undefined
        }
      >
        <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={submit}
          disabled={submitting || readyRows.length === 0 || !bucketId}
        >
          {submitting ? "Saving…" : `Save ${readyRows.length || ""}`.trim()}{" "}
          <Icon name="check" size={13} />
        </button>
      </Modal.Footer>
    </Modal>
  );
}

// Collapsed draft row — the native holdings-row grammar.
function DraftRow({
  row,
  onEdit,
  onRemove,
}: {
  row: Row;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const anchor = isAnchor(row.kind);
  const hasTicker = row.ticker.trim().length > 0;
  // Filled rows read as a verb ("Bought K-EQUITY", "Balance · K-FIXED"); a blank
  // row just names its type ("Balance" / "Buy"), never the past-tense verb.
  const name = hasTicker
    ? `${VERB[row.kind]}${anchor ? " · " : " "}${row.ticker}`
    : TXN_KIND_LABEL[row.kind];
  const sub: string[] = [];
  if (row.tradeDate) sub.push(fmtDate(row.tradeDate));
  if (row.units.trim()) sub.push(`${numFmt(row.units)}${anchor ? " units" : ""}`);
  if (row.price.trim()) sub.push(anchor ? `avg ฿${numFmt(row.price)}` : `@ ฿${numFmt(row.price)}`);
  // Amount shown on the right: dividend/fee carry it directly; a trade derives it
  // from units × price (there's no separate amount field anymore).
  const amountOnly = row.kind === "dividend" || row.kind === "fee";
  const amt = anchor
    ? ""
    : amountOnly
      ? row.amount.trim()
        ? baht(Math.abs(Number(row.amount)))
        : ""
      : row.units.trim() && row.price.trim()
        ? baht(Number(row.units) * Number(row.price))
        : "";
  // What this row still NEEDS to be saveable — kind-aware, mirroring the same checks
  // as valid(). Surfaced amber in the subline so an incomplete row tells you the
  // actual missing required field (not just cost). Only meaningful once a symbol is in.
  let needs: string | null = null;
  if (hasTicker) {
    if (anchor) {
      if (!(Number(row.units) > 0) && !(Number(row.value) > 0)) needs = "needs units or a ฿ total";
    } else {
      const d = normalizeTxnDraft({
        tradeDate: row.tradeDate,
        kind: row.kind,
        ticker: row.ticker,
        units: row.units,
        pricePerUnit: row.price,
        amount: row.amount,
        fee: row.fee,
      });
      if (d.needsDate) needs = "needs a date";
      else if (row.kind === "split") {
        if (d.units == null) needs = "needs a split ratio";
      } else if (d.needsAmount) needs = "needs an amount";
    }
  }
  // Cost is OPTIONAL — a softer nudge ("adding one unlocks gains"), shown only once the
  // row is otherwise complete (so a required gap takes priority).
  const costUnknown =
    !needs && anchor && hasTicker && !row.price.trim() && !(Number(row.costTotal) > 0);
  return (
    <div className="holding" style={{ display: "flex", gap: 4 }}>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${name || "row"}`}
        style={{
          display: "grid",
          gridTemplateColumns: "32px 1fr auto",
          alignItems: "center",
          gap: 10,
          flex: 1,
          minWidth: 0,
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span className="swatch" style={{ background: TONE[row.kind] }}>
          {ABBR[row.kind]}
        </span>
        <span style={{ minWidth: 0 }}>
          <span className="name" style={{ display: "block" }}>
            {name || "New row"}
          </span>
          <span className="sub" style={{ display: "block" }}>
            {/* No symbol yet → unfilled, regardless of a Balance's default date. */}
            {hasTicker ? sub.join(" · ") || "Tap to fill in" : "Tap to fill in"}
            {needs ? (
              <span style={{ color: "var(--amber)" }}> · {needs}</span>
            ) : costUnknown ? (
              <span style={{ color: "var(--amber)" }}> · no cost yet</span>
            ) : null}
          </span>
        </span>
        <span className="value">{amt}</span>
      </button>
      <button
        type="button"
        className="icon-btn quiet"
        onClick={onRemove}
        aria-label="Remove row"
        style={{ alignSelf: "center", flexShrink: 0 }}
      >
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}

// Expanded editor — the native `.rec-edit` grid; Type spans anchor + trades.
function RowEditor({
  row,
  tickers,
  onChange,
  onDone,
  onRemove,
}: {
  row: Row;
  tickers: TickerSuggestion[];
  onChange: (p: Partial<Row>) => void;
  onDone: () => void;
  onRemove: () => void;
}) {
  const anchor = isAnchor(row.kind);
  // Dividend / fee are pure ฿ flows — no units or price, just an amount.
  const amountOnly = row.kind === "dividend" || row.kind === "fee";
  // A Balance recorded by its ฿ value (not a unit count): avg cost is optional here
  // — units (and any cost) are derived from the value, so the cost field steps back.
  const anchorValueDriven = anchor && Number(row.value) > 0;
  // A symbol priced by a live feed (a catalog fund, or a market ETF) makes its
  // price / current-price OPTIONAL — we can value it without one. A custom asset or a
  // not-yet-typed symbol shows NO cue (just "Price"), like the other required fields:
  // we only ever flag "optional", never "needed".
  const pricedByFeed = row.ticker.trim().length > 0 && (row.quoteSource ?? "manual") !== "manual";
  const cls = `rec-edit${anchor ? " is-anchor" : amountOnly ? " is-flow" : ""}`;
  return (
    <div className="ledger-edit-card">
      <div className={cls}>
        <label className="rec-field">
          <span className="rec-label">Type</span>
          <select
            value={row.kind}
            onChange={(e) => {
              const k = e.target.value as RowKind;
              // The ฿ total lives in `value` on a Balance, `amount` on a trade —
              // carry it across when the type flips so a figure typed in ฿ mode
              // survives the switch (and clear the field it left).
              const toAnchor = isAnchor(k);
              const ledgerMove =
                toAnchor === anchor
                  ? {}
                  : toAnchor
                    ? { value: row.amount, amount: "" }
                    : { amount: row.value ?? "", value: "" };
              onChange({
                kind: k,
                ...ledgerMove,
                // Switching to a Balance with no date yet defaults it to today.
                ...(toAnchor && !row.tradeDate ? { tradeDate: today() } : {}),
              });
            }}
            aria-label="Type"
          >
            {typeSelectOptions(row.kind).map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="rec-field">
          <span className="rec-label">{anchor ? "As-of date" : "Date"}</span>
          <input
            type="date"
            value={row.tradeDate}
            onChange={(e) => onChange({ tradeDate: e.target.value })}
            aria-label={anchor ? "As-of date" : "Trade date"}
          />
        </label>
        <div className="rec-field">
          <span className="rec-label">Symbol</span>
          <SymbolCombobox
            value={row.ticker}
            quoteSource={row.quoteSource}
            sourceLocked={row.quoteSourceLocked}
            pool={tickers}
            onChange={(text) =>
              onChange({
                ticker: text,
                englishName: undefined,
                // Editing the symbol re-infers the source unless the user pinned it.
                ...(row.quoteSourceLocked ? {} : { quoteSource: undefined }),
              })
            }
            onPick={(s) =>
              onChange({
                ticker: s.ticker,
                englishName: s.name,
                quoteSource: s.quoteSource,
                quoteSourceLocked: false,
              })
            }
            onToggleSource={() => {
              // Cycle Thai fund → Stock/ETF → Custom (manual price).
              const qs = row.quoteSource ?? "manual";
              const next: QuoteSource =
                qs === "thai_mutual_fund"
                  ? "market"
                  : qs === "market"
                    ? "manual"
                    : "thai_mutual_fund";
              onChange({ quoteSource: next, quoteSourceLocked: true });
            }}
          />
        </div>
        {amountOnly ? (
          <label className="rec-field">
            <span className="rec-label">฿ Amount</span>
            <input
              value={row.amount}
              onChange={(e) => onChange({ amount: e.target.value })}
              placeholder="Amount"
              inputMode="decimal"
              aria-label="Amount in baht"
            />
          </label>
        ) : (
          <>
            <div className="rec-field">
              <span className="rec-label">{anchor ? "Units or ฿ total" : "Units or ฿ amount"}</span>
              <QtyInput
                units={row.units}
                price={anchor ? row.currentPrice || row.price : row.price}
                // A Balance persists its ฿ figure in `value`; a trade in its `amount`
                // (its authoritative money field) — so a total typed in ฿ mode survives
                // collapse/expand and the server can derive units from it (#130).
                value={anchor ? row.value : row.amount}
                onUnits={(v) => onChange({ units: v })}
                onValue={(v) => onChange(anchor ? { value: v } : { amount: v })}
              />
            </div>
            <label className="rec-field">
              <span className="rec-label">
                {anchor ? "Avg cost" : "Price"}
                {/* A trade on a feed-priced symbol can derive units from NAV / the ฿
                    amount, so its Price is optional. (Avg cost on a Balance is never
                    "optional" — it's encouraged via the amber nudge instead.) */}
                {!anchor && pricedByFeed && <span className="rec-opt"> · optional</span>}
              </span>
              <input
                value={row.price}
                onChange={(e) => onChange({ price: e.target.value, estimated: false })}
                placeholder={
                  !anchor && pricedByFeed ? "Optional" : anchor ? "What you paid" : "Price"
                }
                inputMode="decimal"
                aria-label={anchor ? "Average cost" : "Price"}
                // Avg cost is NOT marked "optional": skippable, but adding it unlocks
                // gains/return — so it reads as a normal field, and the row nudges
                // (amber "no cost yet") when it's blank. A pre-filled figure DERIVED from
                // the ฿ value is an estimate to verify (amber dashed, data-estimated).
                data-optional={!anchor && pricedByFeed ? "" : undefined}
                data-estimated={anchor && anchorValueDriven && row.estimated ? "" : undefined}
                title={
                  anchor
                    ? "Average cost you PAID per unit — optional; left blank, your gains stay blank until you add it. Not today's price (current value comes from the live NAV)."
                    : undefined
                }
              />
            </label>
            {anchor ? (
              <label className="rec-field">
                <span className="rec-label">
                  Current price
                  {pricedByFeed && <span className="rec-opt"> · optional</span>}
                </span>
                <input
                  value={row.currentPrice ?? ""}
                  onChange={(e) => onChange({ currentPrice: e.target.value })}
                  // Optional ONLY for a feed-priced symbol (live NAV); for a custom asset
                  // it's required, but we don't mark required — just "Price", like the
                  // other required fields. Placeholder mirrors the label.
                  placeholder={pricedByFeed ? "Optional" : "Price"}
                  inputMode="decimal"
                  aria-label="Current price"
                  data-optional={pricedByFeed ? "" : undefined}
                  title={
                    pricedByFeed
                      ? "Today's price per unit — optional for a known fund (we use the live NAV)."
                      : "Today's price per unit. For a custom asset with no live feed, set this to value the holding."
                  }
                />
              </label>
            ) : (
              <label className="rec-field">
                <span className="rec-label">
                  Fee<span className="rec-opt"> · optional</span>
                </span>
                <input
                  value={row.fee}
                  onChange={(e) => onChange({ fee: e.target.value })}
                  placeholder="Optional"
                  inputMode="decimal"
                  aria-label="Fee"
                  data-optional=""
                />
              </label>
            )}
          </>
        )}
      </div>
      <div className="ledger-edit-actions">
        <span className="rec-type-help">
          <Icon name="info" size={12} />
          {TXN_KIND_HELP[row.kind]}
        </span>
        <button
          type="button"
          className="btn link sm"
          onClick={onRemove}
          style={{ color: "var(--loss)" }}
        >
          Remove
        </button>
        <button type="button" className="btn primary sm" onClick={onDone}>
          Done <Icon name="check" size={12} />
        </button>
      </div>
    </div>
  );
}
