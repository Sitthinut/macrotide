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
import { mergeWithHoldings, type TickerSuggestion } from "@/lib/data/known-funds";
import { mergeSourceSuggestions } from "@/lib/data/sources";
import { useBuckets, useHoldings } from "@/lib/fetchers/portfolio";
import { invalidate } from "@/lib/fetchers/swr";
import { inferQuoteSource } from "@/lib/market/infer-quote-source";
import type { QuoteSource } from "@/lib/market/sources";
import type { TxnKind } from "@/lib/portfolio/lots";
import type { ExtractedTxnRow } from "@/lib/portfolio/ocr";
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
function seedHoldingToRow(s: ImportSeedRow): Row {
  return {
    id: nextId++,
    kind: "opening",
    tradeDate: "",
    ticker: s.ticker,
    englishName: s.englishName,
    units: s.units != null ? String(s.units) : "",
    price: s.avgCost != null ? String(s.avgCost) : "",
    fee: "",
    amount: "",
    quoteSource: s.quoteSource ?? inferQuoteSource(s.ticker),
    provenance: "image",
  };
}

function seedTxnToRow(e: ExtractedTxnRow): Row {
  const tradeDate = normalizeDate(e.tradeDate ?? "");
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
    quoteSource: inferQuoteSource(e.ticker),
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
    if (holdingsSeed?.length) seeded.push(...holdingsSeed.map(seedHoldingToRow));
    if (txnSeed?.length) seeded.push(...txnSeed.map(seedTxnToRow));
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
  const ingestImage = async (file: File): Promise<Row[]> => {
    const fd = new FormData();
    fd.append("image", file);
    const res = await fetch("/api/import/image", { method: "POST", body: fd });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { rows: ImportSeedRow[] };
    return (body.rows ?? []).filter((r) => r.ticker?.trim()).map(seedHoldingToRow);
  };
  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setImgBusy(true);
    setError(null);
    try {
      const collected: Row[] = [];
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          collected.push(...(await ingestImage(file)));
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
      } else setError("Couldn't read those files. Try a sharper screenshot, or paste the rows.");
    } catch {
      setError("Couldn't read those files. Try a sharper screenshot, or paste the rows.");
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

  const patch = (id: number, p: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const removeRow = (id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (editing === id) setEditing(null);
  };

  const valid = (r: Row): boolean => {
    if (!r.ticker.trim()) return false;
    if (isAnchor(r.kind)) return Number(r.units) > 0;
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
        const quoteSource = r.quoteSource || inferQuoteSource(r.ticker);
        if (isAnchor(r.kind)) {
          return {
            tradeDate: r.tradeDate || new Date().toISOString().slice(0, 10),
            kind: r.kind,
            ticker: r.ticker.trim().toUpperCase(),
            englishName: r.englishName,
            units: Number(r.units),
            pricePerUnit: r.price.trim() === "" ? null : Number(r.price),
            // The Balance's current price → the asset's market-price point.
            marketPrice: r.currentPrice?.trim() ? Number(r.currentPrice) : undefined,
            amount: 0,
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
  // Only flag a missing cost once there's actually a fund on the row.
  const costUnknown = anchor && hasTicker && !row.price.trim();
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
            {sub.join(" · ") || "Tap to fill in"}
            {costUnknown && <span style={{ color: "var(--amber)" }}> · cost not recorded</span>}
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
  const cls = `rec-edit${anchor ? " is-anchor" : amountOnly ? " is-flow" : ""}`;
  return (
    <div className="ledger-edit-card">
      <div className={cls}>
        <select
          value={row.kind}
          onChange={(e) => {
            const k = e.target.value as RowKind;
            // Switching to a Balance with no date yet defaults it to today.
            onChange({ kind: k, ...(isAnchor(k) && !row.tradeDate ? { tradeDate: today() } : {}) });
          }}
          aria-label="Type"
        >
          {typeSelectOptions(row.kind).map((o) => (
            <option key={o.label} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={row.tradeDate}
          onChange={(e) => onChange({ tradeDate: e.target.value })}
          aria-label={anchor ? "As-of date" : "Trade date"}
        />
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
            const qs = row.quoteSource ?? inferQuoteSource(row.ticker);
            const next: QuoteSource =
              qs === "thai_mutual_fund"
                ? "market"
                : qs === "market"
                  ? "manual"
                  : "thai_mutual_fund";
            onChange({ quoteSource: next, quoteSourceLocked: true });
          }}
        />
        {amountOnly ? (
          <input
            value={row.amount}
            onChange={(e) => onChange({ amount: e.target.value })}
            placeholder="฿ amount"
            inputMode="decimal"
            aria-label="Amount in baht"
          />
        ) : (
          <>
            <QtyInput
              units={row.units}
              price={anchor ? row.currentPrice || row.price : row.price}
              onUnits={(v) => onChange({ units: v })}
            />
            <input
              value={row.price}
              onChange={(e) => onChange({ price: e.target.value })}
              placeholder={anchor ? "Avg cost" : "Price"}
              inputMode="decimal"
              aria-label={anchor ? "Average cost" : "Price"}
              title={
                anchor
                  ? "Average cost you PAID per unit — not today's price (current value comes from the live NAV)."
                  : undefined
              }
            />
            {anchor ? (
              <input
                value={row.currentPrice ?? ""}
                onChange={(e) => onChange({ currentPrice: e.target.value })}
                placeholder="Current price"
                inputMode="decimal"
                aria-label="Current price"
                title="Today's price per unit. Only needed for a custom asset we can't price live — for a known fund we use the live NAV."
              />
            ) : (
              <input
                value={row.fee}
                onChange={(e) => onChange({ fee: e.target.value })}
                placeholder="Fee"
                inputMode="decimal"
                aria-label="Fee"
              />
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
