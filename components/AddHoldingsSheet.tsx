"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import {
  filterKnownTickers,
  mergeWithHoldings,
  type TickerSuggestion,
} from "@/lib/data/known-funds";
import { useBuckets, useHoldings } from "@/lib/fetchers/portfolio";
import { invalidate } from "@/lib/fetchers/swr";
import { QUOTE_SOURCE_LABELS, QUOTE_SOURCES, type QuoteSource } from "@/lib/market/sources";

interface Row {
  ticker: string;
  units: string;
  value: string;
  // Optional remembered English name when picked from autocomplete — used as
  // the saved `englishName` so the user doesn't have to retype it.
  englishName?: string;
}

interface ExtractedHolding {
  ticker: string;
  units: string;
  value: string;
  source?: string;
}

interface OcrApiResponse {
  text: string;
}

interface OcrErrorResponse {
  error: string;
  message?: string;
}

export interface AddedHolding {
  ticker: string;
  units: string;
  value: string;
  source: string;
  addedAt: number;
}

export interface AddHoldingsSheetProps {
  open: boolean;
  onClose: () => void;
  onAdd: (rows: AddedHolding[]) => void;
}

export function AddHoldingsSheet({ open, onClose, onAdd }: AddHoldingsSheetProps) {
  const { data: buckets } = useBuckets();
  const { data: holdings } = useHoldings();
  const [method, setMethod] = useState<"paste" | "image" | "manual">("paste");
  // Autocomplete state: which row's ticker input has the dropdown open, plus
  // a debounced copy of the query so typing doesn't re-render on every key.
  const [openSuggestRow, setOpenSuggestRow] = useState<number | null>(null);
  const [debouncedTicker, setDebouncedTicker] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [imgProcessing, setImgProcessing] = useState(false);
  const [ocrText, setOcrText] = useState<string>("");
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrCopied, setOcrCopied] = useState(false);
  const [rows, setRows] = useState<Row[]>([
    { ticker: "", units: "", value: "" },
    { ticker: "", units: "", value: "" },
  ]);
  const [source, setSource] = useState("Manual");
  const [quoteSource, setQuoteSource] = useState<QuoteSource>("thai_mutual_fund");
  const [bucketId, setBucketId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const csvFileRef = useRef<HTMLInputElement>(null);

  // Pick the first bucket as default once buckets load (or when the sheet opens).
  useEffect(() => {
    if (open && !bucketId && buckets && buckets.length > 0) {
      setBucketId(buckets[0].id);
    }
  }, [open, bucketId, buckets]);

  // Merged suggestion list — distinct user holdings surface first, then the
  // static seed. Recomputed only when the holdings response changes.
  const suggestionPool = useMemo<TickerSuggestion[]>(() => {
    return mergeWithHoldings(
      (holdings ?? []).map((h) => ({
        ticker: h.ticker,
        englishName: h.englishName,
        quoteSource: h.quoteSource,
      })),
    );
  }, [holdings]);

  // Debounce the active row's ticker query so the filter doesn't refire on
  // every keystroke. ~120 ms is short enough to feel live, long enough to
  // settle paste / rapid typing.
  const activeQuery = openSuggestRow !== null ? (rows[openSuggestRow]?.ticker ?? "") : "";
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTicker(activeQuery), 120);
    return () => clearTimeout(t);
  }, [activeQuery]);

  const suggestions = useMemo(
    () => (openSuggestRow === null ? [] : filterKnownTickers(suggestionPool, debouncedTicker)),
    [openSuggestRow, suggestionPool, debouncedTicker],
  );

  if (!open) return null;

  const parsePaste = (): Row[] => {
    const lines = pasteText.split("\n").filter((l) => l.trim());
    return lines
      .map((line) => {
        const m = line.match(
          /([A-Z][A-Z0-9&-]+)\s*[:,]?\s*([\d,]+(?:\.\d+)?)\s*(?:units|shares)?(?:\s*[,@]?\s*([\d,]+(?:\.\d+)?))?/i,
        );
        if (!m) return null;
        return {
          ticker: m[1],
          units: m[2].replace(/,/g, ""),
          value: m[3] ? m[3].replace(/,/g, "") : "",
        };
      })
      .filter((r): r is Row => r !== null);
  };

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Allow re-uploading the same file later.
    e.target.value = "";
    if (!file) return;

    // Render a local preview while we hit the API — same UX whether OCR
    // takes 500ms or 8s.
    const reader = new FileReader();
    reader.onload = (ev) => setImgPreview((ev.target?.result as string) ?? null);
    reader.readAsDataURL(file);

    setImgProcessing(true);
    setOcrError(null);
    setOcrText("");
    setOcrCopied(false);

    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/import/image", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as OcrErrorResponse | null;
        setOcrError(body?.message ?? `OCR failed (${res.status})`);
        return;
      }
      const body = (await res.json()) as OcrApiResponse;
      const text = (body.text ?? "").trim();
      setOcrText(text);
      if (!text) {
        setOcrError(
          "Couldn't read this image. Try a sharper crop, or use the Manual tab to enter rows.",
        );
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "Failed to reach OCR endpoint.");
    } finally {
      setImgProcessing(false);
    }
  };

  const copyOcrText = async () => {
    if (!ocrText) return;
    try {
      await navigator.clipboard.writeText(ocrText);
      setOcrCopied(true);
      setTimeout(() => setOcrCopied(false), 1500);
    } catch {
      /* clipboard unavailable — user can select+copy manually */
    }
  };

  const resetOcrState = () => {
    setImgPreview(null);
    setOcrText("");
    setOcrError(null);
    setOcrCopied(false);
    setImgProcessing(false);
  };

  // Hand the OCR transcription to the chat advisor. The advisor extracts
  // holdings and surfaces them as propose_holding cards the user can Accept —
  // the raw text stays intermediate (it rides in the hidden `send` payload, not
  // the visible bubble). Reuses the existing `ai-prompt` handoff that App.tsx
  // listens for; it switches to chat and seeds the message.
  const sendOcrToAdvisor = () => {
    if (!ocrText) return;
    const display =
      "I uploaded a brokerage statement — please pull out my holdings so I can add them.";
    const send =
      "I uploaded a brokerage statement and had it transcribed. Extract each holding " +
      "(ticker, fund/stock name, units, and price/cost if shown) and call propose_holding " +
      "once per position so I can review and add them. Don't invent any numbers you can't " +
      "read.\n\nTRANSCRIPTION:\n" +
      ocrText;
    window.dispatchEvent(new CustomEvent("ai-prompt", { detail: { display, send } }));
    resetOcrState();
    onClose();
  };

  const submit = async () => {
    if (!bucketId) {
      setSubmitError("Pick a portfolio first");
      return;
    }
    // Image tab is pure transcription — there's no "save" action here.
    // The user reads the transcription, copies it into Manual / chat, and
    // closes the sheet. Disable the bottom CTA when they're on this tab.
    if (method === "image") {
      setSubmitError("Image tab is transcription-only. Switch to Manual or Paste to save rows.");
      return;
    }
    let toAdd: (ExtractedHolding & { englishName?: string })[] = [];
    if (method === "paste") toAdd = parsePaste();
    if (method === "manual")
      toAdd = rows
        .filter((r) => r.ticker && (r.units || r.value))
        .map((r) => ({
          ticker: r.ticker,
          units: r.units,
          value: r.value,
          englishName: r.englishName,
        }));

    if (toAdd.length === 0) {
      setSubmitError("No valid rows to add");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      for (const row of toAdd) {
        const units = Number.parseFloat(row.units) || 0;
        const value = row.value ? Number.parseFloat(row.value) || 0 : 0;
        const avgCost = units > 0 && value > 0 ? value / units : 0;
        const ticker = row.ticker.trim().toUpperCase();
        const res = await fetch("/api/holdings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bucketId,
            ticker,
            englishName: row.englishName?.trim() || ticker,
            assetClass: "equity",
            units,
            avgCost,
            ter: 0,
            color: "var(--accent)",
            source: row.source || source,
            quoteSource,
          }),
        });
        if (!res.ok) throw new Error(`Add ${ticker} failed (${res.status})`);
      }
      invalidate(/^\/api\/holdings/);
      onAdd(
        toAdd.map((t) => ({
          ticker: t.ticker,
          units: t.units,
          value: t.value,
          source: t.source || source,
          addedAt: Date.now(),
        })),
      );
      setPasteText("");
      setRows([
        { ticker: "", units: "", value: "" },
        { ticker: "", units: "", value: "" },
      ]);
      resetOcrState();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to add holdings");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? "";
      // Drop a header row if it looks like one (no digits in the first line).
      const lines = text.split(/\r?\n/);
      const looksLikeHeader = lines[0] && !/\d/.test(lines[0]);
      setPasteText((looksLikeHeader ? lines.slice(1) : lines).join("\n"));
    };
    reader.readAsText(file);
    // Allow re-uploading the same file
    e.target.value = "";
  };

  const updateRow = (i: number, field: keyof Row, val: string) => {
    const copy = [...rows];
    copy[i] = { ...copy[i], [field]: val };
    // If the user edits the ticker by typing, clear any remembered englishName
    // — it no longer matches what they have in the field.
    if (field === "ticker") copy[i].englishName = undefined;
    setRows(copy);
  };

  const pickSuggestion = (i: number, s: TickerSuggestion) => {
    const copy = [...rows];
    copy[i] = { ...copy[i], ticker: s.ticker, englishName: s.name };
    setRows(copy);
    setQuoteSource(s.quote_source);
    setOpenSuggestRow(null);
  };

  const addRow = () => setRows([...rows, { ticker: "", units: "", value: "" }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  const previewCount =
    method === "paste"
      ? parsePaste().length
      : method === "image"
        ? 0 // Image tab is transcription-only — no rows queued for save.
        : rows.filter((r) => r.ticker && (r.units || r.value)).length;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle"></div>
        <div className="sheet-title">Add holdings</div>
        <div className="sheet-subtitle">
          Combine holdings from any Thai brokerage. Read-only — we never trade for you.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
          <div>
            <label
              style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--muted)",
                letterSpacing: "0.04em",
                marginBottom: 4,
                display: "block",
              }}
            >
              PORTFOLIO
            </label>
            <select
              value={bucketId}
              onChange={(e) => setBucketId(e.target.value)}
              className="twk-field"
              style={{
                width: "100%",
                padding: "8px 10px",
                background: "var(--card-soft)",
                border: "1px solid var(--line-soft)",
                borderRadius: 8,
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                color: "var(--ink)",
              }}
            >
              {!buckets || buckets.length === 0 ? (
                <option value="">No portfolios yet</option>
              ) : (
                buckets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label
              style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--muted)",
                letterSpacing: "0.04em",
                marginBottom: 4,
                display: "block",
              }}
            >
              SOURCE
            </label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="twk-field"
              style={{
                width: "100%",
                padding: "8px 10px",
                background: "var(--card-soft)",
                border: "1px solid var(--line-soft)",
                borderRadius: 8,
                fontFamily: "var(--font-sans)",
                fontSize: 13,
                color: "var(--ink)",
              }}
            >
              <option>Manual</option>
              <option>SCB Easy Invest</option>
              <option>Kasikorn (K-My Funds)</option>
              <option>Krungsri Asset</option>
              <option>BBLAM</option>
              <option>Other Thai brokerage</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--muted)",
              letterSpacing: "0.04em",
              marginBottom: 4,
              display: "block",
            }}
          >
            TYPE
          </label>
          <select
            value={quoteSource}
            onChange={(e) => setQuoteSource(e.target.value as QuoteSource)}
            className="twk-field"
            style={{
              width: "100%",
              padding: "8px 10px",
              background: "var(--card-soft)",
              border: "1px solid var(--line-soft)",
              borderRadius: 8,
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              color: "var(--ink)",
            }}
          >
            {QUOTE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {QUOTE_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
          <div
            style={{
              fontSize: 11,
              color: "var(--muted)",
              marginTop: 4,
              lineHeight: 1.4,
            }}
          >
            Determines where we fetch prices. Pick "Thai mutual fund" for SEC-registered funds,
            "Stock / ETF / Index" for everything else.
          </div>
        </div>

        <div className="method-tabs">
          <button data-active={method === "paste"} onClick={() => setMethod("paste")}>
            📋 Paste / CSV
          </button>
          <button
            data-active={method === "image"}
            onClick={() => setMethod("image")}
            title="Upload a broker screenshot — we'll extract the rows with AI"
          >
            📷 Image
          </button>
          <button data-active={method === "manual"} onClick={() => setMethod("manual")}>
            ✎ Type
          </button>
        </div>

        {method === "paste" && (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                ref={csvFileRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                style={{ display: "none" }}
                onChange={handleCsvFile}
              />
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => csvFileRef.current?.click()}
              >
                <Icon name="plus" size={12} /> Upload CSV file
              </button>
            </div>
            <textarea
              className="sheet-input"
              placeholder={
                "e.g.\nK-USA-A: 8,945 units\nSCBS&P500: 12,450 units\nK-FIXED-A, 14820, 178420"
              }
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={5}
              style={{ minHeight: 120 }}
            />
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                marginTop: 6,
                lineHeight: 1.45,
                fontFamily: "var(--font-mono)",
              }}
            >
              ⓘ TICKER + units or value · one per line · we&apos;ll parse it
            </div>
          </div>
        )}

        {method === "image" && !imgPreview && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleImage}
            />
            <div className="drop-zone" onClick={() => fileRef.current?.click()}>
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <div className="dz-title">Drop a brokerage screenshot</div>
              <div className="dz-sub">
                or tap to browse · we&apos;ll extract the holdings with AI
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 6,
                alignItems: "flex-start",
                marginTop: 10,
                padding: 10,
                background: "var(--accent-soft)",
                borderRadius: 10,
                fontSize: 11.5,
                color: "var(--accent-ink)",
                lineHeight: 1.5,
              }}
            >
              <span aria-hidden>ⓘ</span>
              <span>
                <strong style={{ fontWeight: 500 }}>How it works:</strong> your screenshot is read
                by AI just long enough to pull out the rows, then discarded — it&apos;s never
                stored. You review every row before anything is saved.
              </span>
            </div>
          </>
        )}

        {method === "image" && imgPreview && (
          <div>
            <div
              style={{
                borderRadius: 12,
                overflow: "hidden",
                border: "1px solid var(--line-soft)",
                marginBottom: 12,
                maxHeight: 180,
                position: "relative",
              }}
            >
              <img
                src={imgPreview}
                alt="preview"
                style={{
                  width: "100%",
                  height: "auto",
                  display: "block",
                  maxHeight: 180,
                  objectFit: "cover",
                }}
              />
              {imgProcessing && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(0,0,0,0.5)",
                    display: "grid",
                    placeItems: "center",
                    color: "white",
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <div className="typing" style={{ marginBottom: 6 }}>
                      <span style={{ background: "white" }}></span>
                      <span style={{ background: "white" }}></span>
                      <span style={{ background: "white" }}></span>
                    </div>
                    <div style={{ fontSize: 12, fontFamily: "var(--font-mono)" }}>
                      Extracting holdings…
                    </div>
                  </div>
                </div>
              )}
            </div>

            {ocrError && (
              <div
                style={{
                  marginBottom: 8,
                  padding: "8px 10px",
                  background: "var(--loss-soft, rgba(220,38,38,0.08))",
                  borderRadius: 8,
                  color: "var(--loss)",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                {ocrError}
              </div>
            )}

            {ocrText && (
              <div
                style={{
                  background: "var(--card-soft)",
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--font-mono)",
                      color: "var(--accent-ink)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    ● TRANSCRIPTION
                  </div>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={copyOcrText}
                    style={{ fontSize: 11, padding: "4px 8px" }}
                  >
                    {ocrCopied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: "8px 10px",
                    background: "var(--bg)",
                    border: "1px solid var(--line-soft)",
                    borderRadius: 6,
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    lineHeight: 1.5,
                    color: "var(--ink)",
                    whiteSpace: "pre-wrap",
                    maxHeight: 280,
                    overflowY: "auto",
                  }}
                >
                  {ocrText}
                </pre>
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: "var(--muted)",
                    lineHeight: 1.4,
                  }}
                >
                  This is what the model read. Hand it to the advisor below and it'll pull out each
                  holding as a card you can add — no copy/paste. Or use the <strong>Manual</strong>{" "}
                  tab to enter rows yourself.
                </div>
              </div>
            )}

            {ocrText && (
              <button
                className="btn primary full"
                onClick={sendOcrToAdvisor}
                style={{ marginBottom: 8 }}
              >
                <Icon name="sparkle" size={13} /> Extract holdings with advisor
              </button>
            )}

            <button className="btn ghost sm full" onClick={resetOcrState}>
              Use a different image
            </button>
          </div>
        )}

        {method === "manual" && (
          <div>
            <div
              className="manual-row"
              style={{
                fontSize: 10,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                fontFamily: "var(--font-mono)",
                paddingBottom: 4,
              }}
            >
              <span style={{ padding: "0 4px" }}>Ticker</span>
              <span style={{ padding: "0 4px" }}>Units</span>
              <span style={{ padding: "0 4px" }}>Value (฿)</span>
              <span></span>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="manual-row">
                <div style={{ position: "relative" }}>
                  <input
                    placeholder="K-USA-A(A)"
                    value={r.ticker}
                    onChange={(e) => updateRow(i, "ticker", e.target.value)}
                    onFocus={() => setOpenSuggestRow(i)}
                    // Delay clearing so a click on the dropdown lands before blur kills it.
                    onBlur={() =>
                      setTimeout(() => setOpenSuggestRow((cur) => (cur === i ? null : cur)), 120)
                    }
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={openSuggestRow === i && suggestions.length > 0}
                    aria-controls={`ticker-suggest-${i}`}
                    autoComplete="off"
                  />
                  {openSuggestRow === i && suggestions.length > 0 && (
                    <div
                      id={`ticker-suggest-${i}`}
                      role="listbox"
                      style={{
                        position: "absolute",
                        top: "calc(100% + 2px)",
                        left: 0,
                        right: 0,
                        zIndex: 10,
                        margin: 0,
                        padding: 4,
                        background: "var(--card)",
                        border: "1px solid var(--line-soft)",
                        borderRadius: 8,
                        boxShadow: "0 6px 16px rgba(0,0,0,0.12)",
                        maxHeight: 220,
                        overflowY: "auto",
                      }}
                    >
                      {suggestions.map((s) => (
                        <div
                          key={`${s.quote_source}:${s.ticker}`}
                          role="option"
                          aria-selected="false"
                          tabIndex={-1}
                        >
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              // mousedown fires before blur — keeps the input from
                              // losing focus and hiding the dropdown before we run.
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
                              fontFamily: "var(--font-sans)",
                              fontSize: 12.5,
                              color: "var(--ink)",
                              lineHeight: 1.3,
                            }}
                          >
                            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                              {s.ticker}
                              {s.fromHoldings && (
                                <span
                                  style={{
                                    marginLeft: 6,
                                    fontSize: 9.5,
                                    color: "var(--muted)",
                                    letterSpacing: "0.04em",
                                  }}
                                >
                                  · YOURS
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--muted)" }}>{s.name}</div>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  placeholder="8,945"
                  value={r.units}
                  onChange={(e) => updateRow(i, "units", e.target.value)}
                />
                <input
                  placeholder="162,804"
                  value={r.value}
                  onChange={(e) => updateRow(i, "value", e.target.value)}
                />
                <button onClick={() => removeRow(i)} aria-label="Remove">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
            <button className="btn ghost sm" style={{ marginTop: 6 }} onClick={addRow}>
              <Icon name="plus" size={12} /> Add row
            </button>
          </div>
        )}

        <div
          style={{
            marginTop: 14,
            padding: "10px 12px",
            background: "var(--card-soft)",
            borderRadius: 10,
            fontSize: 12,
            color: "var(--ink-soft)",
            lineHeight: 1.45,
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <Icon name="sparkle" size={14} />
          <div>
            <strong style={{ fontWeight: 500 }}>Or ask the advisor:</strong> say &quot;Add 50k of
            K-FIXED-A from my SCB account&quot; in chat. The advisor confirms before applying.
          </div>
        </div>

        {submitError && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 12px",
              background: "var(--loss-soft, rgba(220,38,38,0.08))",
              borderRadius: 8,
              color: "var(--loss)",
              fontSize: 12.5,
            }}
          >
            {submitError}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn primary"
            style={{ flex: 2 }}
            onClick={submit}
            disabled={previewCount === 0 || submitting || !bucketId}
          >
            {submitting
              ? "Adding…"
              : previewCount > 0
                ? `Add ${previewCount} holding${previewCount > 1 ? "s" : ""}`
                : "Add holdings"}
            <Icon name="check" size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
