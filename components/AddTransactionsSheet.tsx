"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import {
  filterKnownTickers,
  mergeWithHoldings,
  type TickerSuggestion,
} from "@/lib/data/known-funds";
import { mergeSourceSuggestions } from "@/lib/data/sources";
import { useBuckets, useHoldings } from "@/lib/fetchers/portfolio";
import { invalidate } from "@/lib/fetchers/swr";
import { inferQuoteSource } from "@/lib/market/infer-quote-source";
import type { QuoteSource } from "@/lib/market/sources";
import type { TxnKind } from "@/lib/portfolio/lots";
import type { ExtractedTxnRow } from "@/lib/portfolio/ocr";
import {
  coerceKind,
  normalizeDate,
  normalizeTxnDraft,
  parseTxnPaste,
  TXN_KINDS,
} from "@/lib/portfolio/txn-import";

// A row in the editable confirmation table. Inputs are strings; we normalize on
// save. Unlike the holdings importer, rows are APPENDED (a buy and a later sell
// of the same fund are distinct events) — never deduped by ticker.
interface TxnRow {
  tradeDate: string;
  kind: TxnKind;
  ticker: string;
  englishName?: string;
  units: string;
  price: string;
  fee: string;
  amount: string;
  quoteSource?: QuoteSource;
  provenance?: "paste" | "image";
}

// The dropdown maps over TXN_KINDS (deltas only); the anchor labels exist to
// satisfy the full-kind type and for any shared rendering.
const KIND_LABEL: Record<TxnKind, string> = {
  buy: "Buy",
  sell: "Sell",
  dividend: "Dividend",
  fee: "Fee",
  split: "Split",
  reinvest: "Reinvest",
  opening: "Opening balance",
  snapshot: "Snapshot",
};

interface UploadedImage {
  preview: string;
  name: string;
}

interface OcrErrorResponse {
  error: string;
  message?: string;
}

export interface AddTransactionsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save with the number of rows committed. */
  onSaved?: (count: number) => void;
  /** Default bucket to select (e.g. the active portfolio). */
  defaultBucketId?: string | null;
  /**
   * Rows handed off from the holdings importer's scope-guard (the user uploaded
   * a transaction history there). Seeded once per array identity.
   */
  seedRows?: ExtractedTxnRow[] | null;
  /** Snapshot ↔ Activity segmented control, injected by AddToPortfolioSheet. */
  modeToggle?: React.ReactNode;
}

const blankRow = (): TxnRow => ({
  tradeDate: "",
  kind: "buy",
  ticker: "",
  units: "",
  price: "",
  fee: "",
  amount: "",
});

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  color: "var(--muted)",
  letterSpacing: "0.04em",
  marginBottom: 4,
  display: "block",
};

// Amber "needs attention" treatment for an empty required field, matching the
// holdings importer. Held back while the row is focused (see activeRow).
const NEEDS_STYLE: React.CSSProperties = {
  borderColor: "var(--amber)",
  background: "color-mix(in oklab, var(--amber) 12%, transparent)",
};

export function AddTransactionsSheet({
  open,
  onClose,
  onSaved,
  defaultBucketId,
  seedRows,
  modeToggle,
}: AddTransactionsSheetProps) {
  const { data: buckets } = useBuckets();
  const { data: holdings } = useHoldings();
  const [method, setMethod] = useState<"paste" | "image">("paste");
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState<TxnRow[]>([blankRow(), blankRow()]);
  const [bucketId, setBucketId] = useState("");
  const [source, setSource] = useState("");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [imgProcessing, setImgProcessing] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Row currently being edited — used to hold back the amber "needs …" flag
  // until the user actually leaves an incomplete row.
  const [activeRow, setActiveRow] = useState<number | null>(null);
  // Per-row symbol-autocomplete dropdown (one open at a time) + debounced query.
  const [openSuggestRow, setOpenSuggestRow] = useState<number | null>(null);
  const [debouncedTicker, setDebouncedTicker] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (!bucketId) {
      const pick = defaultBucketId || buckets?.[0]?.id;
      if (pick) setBucketId(pick);
    }
  }, [open, bucketId, defaultBucketId, buckets]);

  // Source suggestions: the user's own holding sources first, then brokerage
  // starters — same helper the holdings importer uses (native <datalist>).
  const sourceOptions = useMemo(
    () => mergeSourceSuggestions((holdings ?? []).map((h) => h.source)),
    [holdings],
  );

  // Symbol suggestions: distinct user holdings first, then the static seed.
  const suggestionPool = useMemo<TickerSuggestion[]>(
    () =>
      mergeWithHoldings(
        (holdings ?? []).map((h) => ({
          ticker: h.ticker,
          englishName: h.englishName,
          quoteSource: h.quoteSource,
        })),
      ),
    [holdings],
  );
  const activeQuery = openSuggestRow !== null ? (rows[openSuggestRow]?.ticker ?? "") : "";
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTicker(activeQuery), 120);
    return () => clearTimeout(t);
  }, [activeQuery]);
  const suggestions = useMemo(
    () =>
      openSuggestRow === null || !debouncedTicker.trim()
        ? []
        : filterKnownTickers(suggestionPool, debouncedTicker),
    [openSuggestRow, suggestionPool, debouncedTicker],
  );

  // ── row helpers ────────────────────────────────────────────────────────────
  const extractedToRow = (e: ExtractedTxnRow): TxnRow => ({
    tradeDate: normalizeDate(e.tradeDate ?? ""),
    kind: coerceKind(e.kind),
    ticker: e.ticker,
    englishName: e.englishName,
    units: e.units != null ? String(e.units) : "",
    price: e.pricePerUnit != null ? String(e.pricePerUnit) : "",
    fee: e.fee != null ? String(e.fee) : "",
    amount: e.amount != null ? String(e.amount) : "",
    quoteSource: inferQuoteSource(e.ticker),
    provenance: "image",
  });

  const draftToRow = (d: ReturnType<typeof parseTxnPaste>[number]): TxnRow => ({
    tradeDate: d.tradeDate,
    kind: d.kind,
    ticker: d.ticker,
    englishName: d.englishName,
    units: d.units != null ? String(d.units) : "",
    price: d.pricePerUnit != null ? String(d.pricePerUnit) : "",
    fee: d.fee != null ? String(d.fee) : "",
    amount: d.amount != null ? String(d.amount) : "",
    quoteSource: d.quoteSource,
    provenance: "paste",
  });

  // Append new rows after any non-empty existing rows (drop leading blanks).
  const appendRows = (incoming: TxnRow[]) => {
    if (incoming.length === 0) return;
    setRows((prev) => {
      const kept = prev.filter((r) => r.ticker.trim() || r.amount.trim());
      return [...kept, ...incoming, blankRow()];
    });
  };

  // Seed handoff from the holdings scope-guard (consume once per identity).
  const seededRef = useRef<ExtractedTxnRow[] | null>(null);
  useEffect(() => {
    if (!open || !seedRows || seedRows.length === 0) return;
    if (seededRef.current === seedRows) return;
    seededRef.current = seedRows;
    setMethod(seedRows.some((r) => r.units != null || r.amount != null) ? "image" : "paste");
    appendRows(seedRows.map(extractedToRow));
  }, [open, seedRows]);

  const stagePaste = (text: string) => {
    if (!text.trim()) return;
    appendRows(parseTxnPaste(text).map(draftToRow));
  };

  const handleImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = (ev) =>
        setImages((prev) => [
          ...prev,
          { preview: (ev.target?.result as string) ?? "", name: file.name },
        ]);
      reader.readAsDataURL(file);
    }
    setImgProcessing(true);
    setOcrError(null);
    const extracted: TxnRow[] = [];
    let anyFail = false;
    let anyRow = false;
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("image", file);
        const res = await fetch("/api/import/transactions-image", { method: "POST", body: fd });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as OcrErrorResponse | null;
          setOcrError(body?.message ?? `Couldn't read ${file.name} (${res.status})`);
          anyFail = true;
          continue;
        }
        const body = (await res.json()) as { rows: ExtractedTxnRow[] };
        for (const r of body.rows ?? []) {
          if (!r.ticker?.trim()) continue;
          anyRow = true;
          extracted.push(extractedToRow(r));
        }
      } catch (err) {
        setOcrError(err instanceof Error ? err.message : "Failed to reach the import endpoint.");
        anyFail = true;
      }
    }
    appendRows(extracted);
    if (!anyRow && !anyFail) {
      setOcrError(
        "Couldn't find any transactions in this image. Try a sharper screenshot, or type rows below.",
      );
    }
    setImgProcessing(false);
  };

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? "";
      setPasteText(text);
      stagePaste(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const updateRow = (i: number, field: keyof TxnRow, val: string) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[i] = { ...copy[i], [field]: val };
      if (field === "ticker") {
        copy[i].quoteSource = inferQuoteSource(val);
        copy[i].englishName = undefined;
      }
      return copy;
    });
  };

  const pickSuggestion = (i: number, s: TickerSuggestion) => {
    setRows((prev) => {
      const copy = [...prev];
      copy[i] = { ...copy[i], ticker: s.ticker, englishName: s.name, quoteSource: s.quote_source };
      return copy;
    });
    setOpenSuggestRow(null);
  };

  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  // Normalize every row once, for both validation and per-field error styling.
  const drafts = useMemo(
    () =>
      rows.map((r) =>
        normalizeTxnDraft({
          tradeDate: r.tradeDate,
          kind: r.kind,
          ticker: r.ticker,
          englishName: r.englishName,
          units: r.units,
          pricePerUnit: r.price,
          fee: r.fee,
          amount: r.amount,
          quoteSource: r.quoteSource,
        }),
      ),
    [rows],
  );
  const validRows = useMemo(
    () =>
      drafts.filter(
        (d) =>
          d.ticker.trim() &&
          !d.needsDate &&
          (d.kind === "split" ? d.units != null : !d.needsAmount),
      ),
    [drafts],
  );

  const submit = async () => {
    if (!bucketId) {
      setSubmitError("Pick a portfolio first");
      return;
    }
    if (validRows.length === 0) {
      setSubmitError("No complete transactions to save — each needs a date and an amount.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bucketId,
          transactions: validRows.map((d) => ({
            tradeDate: d.tradeDate,
            kind: d.kind,
            ticker: d.ticker.toUpperCase(),
            englishName: d.englishName,
            units: d.units,
            pricePerUnit: d.pricePerUnit,
            fee: d.fee,
            amount: d.kind === "split" ? 0 : (d.amount ?? 0),
            quoteSource: d.quoteSource,
            source: source.trim() || undefined,
          })),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Save failed (${res.status})`);
      }
      const body = (await res.json()) as { count: number };
      invalidate(/^\/api\/transactions/);
      onSaved?.(body.count);
      setRows([blankRow(), blankRow()]);
      setPasteText("");
      setImages([]);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save transactions");
    } finally {
      setSubmitting(false);
    }
  };

  // Renders the Modal CONTENTS only — the single <Modal> shell is owned by
  // AddToPortfolioSheet (one fixed width for both modes; the toggle swaps the
  // body, never the chrome). Must be rendered inside a <Modal>.
  return (
    <>
      <Modal.Header
        title="Add to portfolio"
        subtitle="A buy/sell log builds your realized gains, return, and contribution timeline. Read-only — we never trade for you."
        id="at-title"
      >
        {modeToggle}
      </Modal.Header>
      <Modal.Body>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div>
            <label htmlFor="at-bucket" style={labelStyle}>
              PORTFOLIO
            </label>
            <select
              id="at-bucket"
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
          </div>
          <div>
            <label htmlFor="at-source" style={labelStyle}>
              SOURCE
            </label>
            <input
              id="at-source"
              className="sheet-input"
              list="at-source-suggestions"
              placeholder="Type or pick a source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
            <datalist id="at-source-suggestions">
              {sourceOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        </div>

        {/* Import-method tabs (Icon, not emoji). */}
        <div className="method-tabs">
          <button type="button" data-active={method === "paste"} onClick={() => setMethod("paste")}>
            <Icon name="book" size={13} /> Paste / CSV
          </button>
          <button type="button" data-active={method === "image"} onClick={() => setMethod("image")}>
            <Icon name="chart" size={13} /> Image
          </button>
        </div>

        {method === "paste" ? (
          <div style={{ marginBottom: 14 }}>
            <textarea
              className="sheet-input"
              rows={3}
              placeholder={
                "date, type, ticker, units, price, amount\n2024-01-05, Buy, EXAMPLE-FUND-A, 100, 10.00, 1000"
              }
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              style={{ fontFamily: "var(--font-mono)", fontSize: 12, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn ghost sm" onClick={() => stagePaste(pasteText)}>
                <Icon name="plus" size={12} /> Add rows to table
              </button>
              <button className="btn ghost sm" onClick={() => csvFileRef.current?.click()}>
                Upload CSV
              </button>
              <input
                ref={csvFileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                hidden
                onChange={handleCsvFile}
              />
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <button
              className="btn ghost sm"
              onClick={() => fileRef.current?.click()}
              disabled={imgProcessing}
            >
              <Icon name="plus" size={12} /> {imgProcessing ? "Reading…" : "Upload screenshot(s)"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={handleImages}
            />
            {images.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                {images.map((im) => im.name).join(", ")}
              </div>
            )}
            {ocrError && (
              <div style={{ fontSize: 12, color: "var(--loss)", marginTop: 6 }}>{ocrError}</div>
            )}
          </div>
        )}

        {/* Editable confirmation table — responsive grid: one line on wide screens,
            stacked on narrow (see .txn-row in globals.css). */}
        {rows.map((r, i) => {
          const d = drafts[i];
          const flagDate = d.needsDate && r.ticker.trim() !== "" && activeRow !== i;
          const flagAmount =
            d.needsAmount && d.kind !== "split" && r.ticker.trim() !== "" && activeRow !== i;
          const openUp = i >= Math.max(0, rows.length - 2);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, no stable id pre-save
            <div
              key={i}
              className="txn-row"
              onFocus={() => setActiveRow(i)}
              onBlur={() => setTimeout(() => setActiveRow((cur) => (cur === i ? null : cur)), 100)}
            >
              <input
                type="date"
                className="txn-c-date"
                aria-label="Trade date"
                aria-invalid={flagDate}
                value={r.tradeDate}
                onChange={(e) => updateRow(i, "tradeDate", e.target.value)}
                style={flagDate ? NEEDS_STYLE : undefined}
              />
              <select
                className="txn-c-type"
                aria-label="Type"
                value={r.kind}
                onChange={(e) => updateRow(i, "kind", e.target.value)}
              >
                {TXN_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <div className="txn-c-symbol" style={{ position: "relative" }}>
                <input
                  aria-label="Symbol"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={openSuggestRow === i && suggestions.length > 0}
                  autoComplete="off"
                  placeholder="Symbol"
                  value={r.ticker}
                  onChange={(e) => updateRow(i, "ticker", e.target.value)}
                  onFocus={() => setOpenSuggestRow(i)}
                  onBlur={() =>
                    setTimeout(() => setOpenSuggestRow((cur) => (cur === i ? null : cur)), 120)
                  }
                />
                {openSuggestRow === i && suggestions.length > 0 && (
                  <div
                    role="listbox"
                    style={{
                      position: "absolute",
                      top: openUp ? undefined : "calc(100% + 2px)",
                      bottom: openUp ? "calc(100% + 2px)" : undefined,
                      left: 0,
                      right: 0,
                      zIndex: 80,
                      padding: 4,
                      background: "var(--paper)",
                      border: "1px solid var(--line-soft)",
                      borderRadius: 8,
                      boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
                      maxHeight: 200,
                      overflowY: "auto",
                    }}
                  >
                    {suggestions.map((s) => (
                      <button
                        key={`${s.quote_source}:${s.ticker}`}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickSuggestion(i, s);
                        }}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "6px 8px",
                          border: "none",
                          background: "transparent",
                          borderRadius: 6,
                          cursor: "pointer",
                          color: "var(--ink)",
                        }}
                      >
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                          {s.ticker}
                          {s.fromHoldings && (
                            <span style={{ marginLeft: 6, fontSize: 9.5, color: "var(--muted)" }}>
                              · YOURS
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.name}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <input
                className="txn-c-units"
                aria-label="Units"
                inputMode="decimal"
                placeholder="Units"
                value={r.units}
                onChange={(e) => updateRow(i, "units", e.target.value)}
              />
              <input
                className="txn-c-price"
                aria-label="Price per unit"
                inputMode="decimal"
                placeholder="Price/unit"
                value={r.price}
                onChange={(e) => updateRow(i, "price", e.target.value)}
              />
              <input
                className="txn-c-fee"
                aria-label="Fee in baht (optional)"
                inputMode="decimal"
                placeholder="Fee"
                title="Optional — front-end fee in ฿, folded into the cash amount"
                value={r.fee}
                onChange={(e) => updateRow(i, "fee", e.target.value)}
              />
              <input
                className="txn-c-amount"
                aria-label="Amount in baht"
                aria-invalid={flagAmount}
                inputMode="decimal"
                placeholder={r.kind === "split" ? "ratio in Units" : "฿ amount"}
                value={r.amount}
                onChange={(e) => updateRow(i, "amount", e.target.value)}
                disabled={r.kind === "split"}
                style={flagAmount ? NEEDS_STYLE : undefined}
              />
              <button
                type="button"
                className="txn-row__remove txn-c-remove"
                aria-label="Remove transaction"
                onClick={() => removeRow(i)}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          );
        })}

        <button className="btn ghost sm" onClick={addRow} style={{ marginTop: 2 }}>
          <Icon name="plus" size={12} /> Add row
        </button>

        {submitError && (
          <div
            style={{
              fontSize: 12.5,
              color: "var(--loss)",
              background: "color-mix(in oklab, var(--loss) 8%, transparent)",
              borderRadius: 8,
              padding: "8px 10px",
              marginTop: 12,
            }}
          >
            {submitError}
          </div>
        )}
      </Modal.Body>
      <Modal.Footer
        start={
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{validRows.length} ready</span>
        }
      >
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" onClick={submit} disabled={submitting}>
          {submitting ? "Saving…" : "Save transactions"} <Icon name="check" size={13} />
        </button>
      </Modal.Footer>
    </>
  );
}
