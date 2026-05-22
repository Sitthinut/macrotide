"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useBuckets } from "@/lib/fetchers/portfolio";
import { invalidate } from "@/lib/fetchers/swr";
import { QUOTE_SOURCE_LABELS, QUOTE_SOURCES, type QuoteSource } from "@/lib/market/sources";

interface Row {
  ticker: string;
  units: string;
  value: string;
}

interface ExtractedHolding {
  ticker: string;
  units: string;
  value: string;
  source?: string;
}

/** A row as returned by /api/import/image, after the user has had a chance
 *  to edit it in the confirmation table. */
interface OcrRow {
  ticker: string;
  englishName: string;
  units: string;
  avgCost: string;
  quoteSource: QuoteSource;
  error?: string | null;
}

interface OcrApiResponse {
  rows: Array<{
    ticker: string;
    englishName?: string;
    units: number;
    avgCost?: number;
    quoteSource: QuoteSource;
  }>;
}

interface OcrErrorResponse {
  error: string;
  message?: string;
}

function emptyOcrRow(quoteSource: QuoteSource): OcrRow {
  return {
    ticker: "",
    englishName: "",
    units: "",
    avgCost: "",
    quoteSource,
    error: null,
  };
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
  const [method, setMethod] = useState<"paste" | "image" | "manual">("paste");
  const [pasteText, setPasteText] = useState("");
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [imgProcessing, setImgProcessing] = useState(false);
  const [ocrRows, setOcrRows] = useState<OcrRow[] | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
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
    setOcrRows(null);

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
      if (!body.rows || body.rows.length === 0) {
        setOcrError(
          "Couldn't read any holdings from that image. Try a sharper crop, or add rows manually below.",
        );
        setOcrRows([emptyOcrRow(quoteSource)]);
        return;
      }
      setOcrRows(
        body.rows.map((r) => ({
          ticker: r.ticker,
          englishName: r.englishName ?? "",
          units: String(r.units),
          avgCost: r.avgCost != null ? String(r.avgCost) : "",
          quoteSource: r.quoteSource,
          error: null,
        })),
      );
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "Failed to reach OCR endpoint.");
    } finally {
      setImgProcessing(false);
    }
  };

  const updateOcrRow = (i: number, patch: Partial<OcrRow>) => {
    setOcrRows((prev) => {
      if (!prev) return prev;
      const copy = [...prev];
      copy[i] = { ...copy[i], ...patch };
      return copy;
    });
  };
  const removeOcrRow = (i: number) =>
    setOcrRows((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev));
  const addOcrRow = () => setOcrRows((prev) => [...(prev ?? []), emptyOcrRow(quoteSource)]);

  const resetOcrState = () => {
    setImgPreview(null);
    setOcrRows(null);
    setOcrError(null);
    setImgProcessing(false);
  };

  const saveOcrRows = async () => {
    if (!bucketId) {
      setOcrError("Pick a portfolio first");
      return;
    }
    if (!ocrRows || ocrRows.length === 0) {
      setOcrError("Nothing to save — add at least one row.");
      return;
    }

    // Validate before we hit the network so per-row errors render inline.
    let hasError = false;
    const validated = ocrRows.map((r) => {
      const ticker = r.ticker.trim().toUpperCase();
      const units = Number.parseFloat(r.units);
      if (!ticker) {
        hasError = true;
        return { ...r, error: "Ticker required" };
      }
      if (!Number.isFinite(units) || units <= 0) {
        hasError = true;
        return { ...r, error: "Units must be a positive number" };
      }
      return { ...r, ticker, error: null as string | null };
    });
    setOcrRows(validated);
    if (hasError) return;

    setOcrError(null);
    try {
      let saved = 0;
      const next = [...validated];
      for (let i = 0; i < next.length; i++) {
        const r = next[i];
        const units = Number.parseFloat(r.units);
        const avgCost = r.avgCost ? Number.parseFloat(r.avgCost) : 0;
        const ticker = r.ticker;
        const englishName = r.englishName.trim() || ticker;
        const res = await fetch("/api/holdings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bucketId,
            ticker,
            englishName,
            assetClass: "equity",
            units,
            avgCost: Number.isFinite(avgCost) ? avgCost : 0,
            ter: 0,
            color: "var(--accent)",
            source: source || "Image OCR",
            quoteSource: r.quoteSource,
          }),
        });
        if (!res.ok) {
          next[i] = { ...r, error: `Save failed (${res.status})` };
          setOcrRows(next);
          hasError = true;
          break;
        }
        saved += 1;
      }
      if (!hasError) {
        invalidate(/^\/api\/holdings/);
        onAdd(
          validated.map((r) => ({
            ticker: r.ticker,
            units: r.units,
            value: r.avgCost
              ? String(Number.parseFloat(r.units) * Number.parseFloat(r.avgCost))
              : "",
            source: source || "Image OCR",
            addedAt: Date.now(),
          })),
        );
        resetOcrState();
        onClose();
      } else if (saved > 0) {
        setOcrError(`Saved ${saved} of ${validated.length}. Fix the row above and retry.`);
      }
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "Failed to save holdings");
    }
  };

  const submit = async () => {
    if (!bucketId) {
      setSubmitError("Pick a portfolio first");
      return;
    }
    // Image tab uses its own validation / multi-row save logic, but we toggle
    // the shared `submitting` flag so the bottom CTA disables consistently.
    if (method === "image") {
      setSubmitError(null);
      setSubmitting(true);
      try {
        await saveOcrRows();
      } finally {
        setSubmitting(false);
      }
      return;
    }
    let toAdd: ExtractedHolding[] = [];
    if (method === "paste") toAdd = parsePaste();
    if (method === "manual") toAdd = rows.filter((r) => r.ticker && (r.units || r.value));

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
            englishName: ticker, // user can rename later via HoldingSheet
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
    setRows(copy);
  };

  const addRow = () => setRows([...rows, { ticker: "", units: "", value: "" }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  const previewCount =
    method === "paste"
      ? parsePaste().length
      : method === "image"
        ? (ocrRows?.filter((r) => r.ticker.trim() && r.units.trim()).length ?? 0)
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
                "e.g.\nK-USA-A: 8,945 units\nSCBS&P500: 12,450 units\nK-FIXED, 14820, 178420"
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
                marginTop: 10,
                padding: 10,
                background: "var(--accent-soft)",
                borderRadius: 10,
                fontSize: 11.5,
                color: "var(--accent-ink)",
                lineHeight: 1.5,
              }}
            >
              ⓘ <strong style={{ fontWeight: 500 }}>How it works:</strong> the screenshot is sent to
              a free-tier OpenRouter vision model just long enough to extract the rows. Not stored.
              You review every row before anything is saved.
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

            {ocrRows && (
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
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    color: "var(--accent-ink)",
                    letterSpacing: "0.04em",
                    marginBottom: 8,
                  }}
                >
                  ● REVIEW & EDIT · {ocrRows.length} {ocrRows.length === 1 ? "ROW" : "ROWS"}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 0.8fr 0.8fr 1fr 24px",
                    gap: 6,
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    paddingBottom: 4,
                  }}
                >
                  <span style={{ padding: "0 4px" }}>Ticker</span>
                  <span style={{ padding: "0 4px" }}>Name</span>
                  <span style={{ padding: "0 4px" }}>Units</span>
                  <span style={{ padding: "0 4px" }}>Avg cost</span>
                  <span style={{ padding: "0 4px" }}>Type</span>
                  <span></span>
                </div>

                {ocrRows.map((r, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: ocrRows is an editable
                  // local table; row identity is positional, no stable id available.
                  <div key={i} style={{ marginBottom: 6 }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 0.8fr 0.8fr 1fr 24px",
                        gap: 6,
                        alignItems: "center",
                      }}
                    >
                      <input
                        placeholder="K-FIXED-A"
                        value={r.ticker}
                        onChange={(e) => updateOcrRow(i, { ticker: e.target.value })}
                        style={{
                          padding: "6px 8px",
                          background: "var(--bg)",
                          border: "1px solid var(--line-soft)",
                          borderRadius: 6,
                          fontSize: 12,
                          fontFamily: "var(--font-mono)",
                          color: "var(--ink)",
                          minWidth: 0,
                        }}
                      />
                      <input
                        placeholder="(optional)"
                        value={r.englishName}
                        onChange={(e) => updateOcrRow(i, { englishName: e.target.value })}
                        style={{
                          padding: "6px 8px",
                          background: "var(--bg)",
                          border: "1px solid var(--line-soft)",
                          borderRadius: 6,
                          fontSize: 12,
                          color: "var(--ink)",
                          minWidth: 0,
                        }}
                      />
                      <input
                        placeholder="0.00"
                        inputMode="decimal"
                        value={r.units}
                        onChange={(e) => updateOcrRow(i, { units: e.target.value })}
                        style={{
                          padding: "6px 8px",
                          background: "var(--bg)",
                          border: "1px solid var(--line-soft)",
                          borderRadius: 6,
                          fontSize: 12,
                          color: "var(--ink)",
                          minWidth: 0,
                          textAlign: "right",
                        }}
                      />
                      <input
                        placeholder="—"
                        inputMode="decimal"
                        value={r.avgCost}
                        onChange={(e) => updateOcrRow(i, { avgCost: e.target.value })}
                        style={{
                          padding: "6px 8px",
                          background: "var(--bg)",
                          border: "1px solid var(--line-soft)",
                          borderRadius: 6,
                          fontSize: 12,
                          color: "var(--ink)",
                          minWidth: 0,
                          textAlign: "right",
                        }}
                      />
                      <select
                        value={r.quoteSource}
                        onChange={(e) =>
                          updateOcrRow(i, { quoteSource: e.target.value as QuoteSource })
                        }
                        style={{
                          padding: "6px 4px",
                          background: "var(--bg)",
                          border: "1px solid var(--line-soft)",
                          borderRadius: 6,
                          fontSize: 11,
                          color: "var(--ink)",
                          minWidth: 0,
                        }}
                      >
                        {QUOTE_SOURCES.map((s) => (
                          <option key={s} value={s}>
                            {QUOTE_SOURCE_LABELS[s]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeOcrRow(i)}
                        aria-label="Remove row"
                        style={{
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--muted)",
                          padding: 4,
                        }}
                      >
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
                    {r.error && (
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: 11,
                          color: "var(--loss)",
                          paddingLeft: 4,
                        }}
                      >
                        {r.error}
                      </div>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  className="btn ghost sm"
                  style={{ marginTop: 4 }}
                  onClick={addOcrRow}
                >
                  <Icon name="plus" size={12} /> Add row
                </button>
              </div>
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
                <input
                  placeholder="K-USA-A(A)"
                  value={r.ticker}
                  onChange={(e) => updateRow(i, "ticker", e.target.value)}
                />
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
            K-FIXED from my SCB account&quot; in chat. The agent confirms before applying.
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
