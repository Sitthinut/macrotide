"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import {
  filterKnownTickers,
  mergeWithHoldings,
  type TickerSuggestion,
} from "@/lib/data/known-funds";
import { mergeSourceSuggestions } from "@/lib/data/sources";
import type { ShareClassListItem } from "@/lib/db/queries/funds";
import { useBuckets, useHoldings } from "@/lib/fetchers/portfolio";
import { invalidate, useResource } from "@/lib/fetchers/swr";
import { inferQuoteSource } from "@/lib/market/infer-quote-source";
import type { QuoteSource } from "@/lib/market/sources";
import type { ExtractedTxnRow } from "@/lib/portfolio/ocr";
import { looksLikeTransactionHistory } from "@/lib/portfolio/txn-import";
import type { ImportSeedRow } from "@/lib/stores/import-seed";

// Shape of /api/fund-classes/resolve — validates a typed ticker against the
// catalog: a bare parent ("MDIVA") with several share classes is NOT priceable
// and must be swapped for a real class ("MDIVA-A") before it can be saved.
interface ResolveResult {
  ticker: string;
  valid: boolean;
  isParentWithClasses: boolean;
  classes?: {
    ticker: string;
    distributionPolicy: string | null;
    taxIncentiveType: string | null;
  }[];
}

// Compact 2–3 char codes for the in-input price-source badge.
const TYPE_BADGE_CODES: Record<QuoteSource, string> = {
  thai_mutual_fund: "TH",
  yahoo: "ETF",
};

// "Set all" segmented toggle: Thai-first order for a Thai-market app, with
// short labels (the full QUOTE_SOURCE_LABELS are too long for two segments).
const SOURCE_SEG_ORDER: readonly QuoteSource[] = ["thai_mutual_fund", "yahoo"];
const SOURCE_SEG_LABELS: Record<QuoteSource, string> = {
  thai_mutual_fund: "Thai fund",
  yahoo: "Stock / ETF",
};

interface Row {
  ticker: string;
  units: string;
  avgCost: string;
  provenance?: "paste" | "image";
  // Optional remembered English name when picked from autocomplete — used as
  // the saved `englishName` so the user doesn't have to retype it.
  englishName?: string;
  // Per-row price source. When unset, the effective value is inferred live from
  // the ticker (inferQuoteSource); `quoteSourceLocked` marks an explicit user
  // choice so editing the ticker won't re-infer over it.
  quoteSource?: QuoteSource;
  quoteSourceLocked?: boolean;
  // Set on rows pre-filled from an image extract: `estimated` means a number
  // was derived (units/avgCost from NAV) not read off the screen; `needsUnits`
  // means we couldn't derive units and the user should type them.
  estimated?: boolean;
  needsUnits?: boolean;
}

// Shape returned by /api/import/image — one row per holding the vision model
// read, with units/avgCost derived from NAV where possible. Mirrors `DerivedRow`
// in lib/portfolio/ocr.ts; identical to the in-chat importer's ImportSeedRow, so
// the image path and the chat-seed path share one row→table mapping.
type ImportedRow = ImportSeedRow;

interface ImportApiResponse {
  rows: ImportedRow[];
}

// Unified dropdown suggestion — covers both the static seed / user-holdings
// source (TickerSuggestion) and a live catalog share class. `distributionPolicy`
// is set only for catalog rows, so the dropdown can show an Acc/Div tag that
// distinguishes sibling classes (MDIVA-A acc vs MDIVA-D div).
interface CatalogSuggestion {
  ticker: string;
  name: string;
  quote_source: QuoteSource;
  fromHoldings?: boolean;
  /** 'accumulating' | 'dividend' | null — only present for catalog matches. */
  distributionPolicy?: string | null;
}

interface OcrErrorResponse {
  error: string;
  message?: string;
}

// Local preview of an uploaded screenshot while/after extraction.
interface UploadedImage {
  preview: string;
  name: string;
}

export interface AddedHolding {
  ticker: string;
  units: string;
  avgCost: string;
  source: string;
  addedAt: number;
}

export interface AddHoldingsSheetProps {
  open: boolean;
  onClose: () => void;
  onAdd: (rows: AddedHolding[]) => void;
  /**
   * Rows to pre-seed into the confirmation table when the sheet opens — used by
   * the Advisor's in-chat holdings table (lib/stores/import-seed.ts). Merged in
   * exactly like an image extract; consumed once per array identity.
   */
  seedRows?: ImportSeedRow[] | null;
  /**
   * Scope-guard handoff: the upload looked like a TRANSACTION history (dates /
   * prices per row), not a holdings snapshot. Closes this sheet and opens the
   * transaction importer, carrying the ticker stubs so the user needn't re-type.
   */
  onSwitchToTransactions?: (seed?: ExtractedTxnRow[] | null) => void;
  /** Snapshot ↔ Activity segmented control, injected by AddToPortfolioSheet. */
  modeToggle?: React.ReactNode;
}

export function AddHoldingsSheet({
  open,
  onClose,
  onAdd,
  seedRows,
  onSwitchToTransactions,
  modeToggle,
}: AddHoldingsSheetProps) {
  const { data: buckets } = useBuckets();
  const { data: holdings } = useHoldings();
  const [method, setMethod] = useState<"paste" | "image">("paste");
  // Autocomplete state: which row's symbol input has the dropdown open, plus
  // a debounced copy of the query so typing doesn't re-render on every key.
  const [openSuggestRow, setOpenSuggestRow] = useState<number | null>(null);
  // Which row is currently being edited (any field focused) — used to hold back
  // the "needs quantity" amber until the user actually leaves an incomplete row.
  const [activeRow, setActiveRow] = useState<number | null>(null);
  const [debouncedTicker, setDebouncedTicker] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasteParseCount, setPasteParseCount] = useState<number | null>(null);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [imgProcessing, setImgProcessing] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  // ONE shared confirmation table. Paste and Image append here, and manual
  // typing happens directly in the table. The user reviews/edits the combined
  // set, and a single Save commits it. Starts with two blank rows so manual
  // entry is usable immediately.
  const [rows, setRows] = useState<Row[]>([
    { ticker: "", units: "", avgCost: "" },
    { ticker: "", units: "", avgCost: "" },
  ]);
  const [source, setSource] = useState("");
  const [bucketId, setBucketId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Scope-guard: set when an import looked like a transaction history; dismissed
  // when the user chooses to import as a snapshot anyway.
  const [txnShapeDetected, setTxnShapeDetected] = useState(false);
  const [scopeGuardDismissed, setScopeGuardDismissed] = useState(false);
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
  const knownTickerSet = useMemo(
    () => new Set(suggestionPool.map((s) => s.ticker.trim().toUpperCase())),
    [suggestionPool],
  );

  // Source-label suggestions for the combobox: the user's previously-used
  // sources first, then common Thai brokerages as starters. Free text — blank
  // is fine (an unknown origin is honest).
  const sourceOptions = useMemo(
    () => mergeSourceSuggestions((holdings ?? []).map((h) => h.source)),
    [holdings],
  );

  // Debounce the active row's symbol query so the filter doesn't refire on
  // every keystroke. ~120 ms is short enough to feel live, long enough to
  // settle paste / rapid typing.
  const activeQuery = openSuggestRow !== null ? (rows[openSuggestRow]?.ticker ?? "") : "";
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTicker(activeQuery), 120);
    return () => clearTimeout(t);
  }, [activeQuery]);

  const localSuggestions = useMemo(
    () =>
      openSuggestRow === null || !debouncedTicker.trim()
        ? []
        : filterKnownTickers(suggestionPool, debouncedTicker),
    [openSuggestRow, suggestionPool, debouncedTicker],
  );

  // Live catalog autocomplete — real priceable SHARE CLASSES from the SEC
  // catalog (GET /api/fund-classes), so the user picks a class that has a NAV
  // rather than a bare parent. Only fires once the query is ≥2 chars to keep it
  // cheap; the static seed + the user's own holdings still surface first.
  const catalogQuery = debouncedTicker.trim();
  const { data: catalogMatches } = useResource<ShareClassListItem[]>(
    openSuggestRow !== null && catalogQuery.length >= 2
      ? `/api/fund-classes?query=${encodeURIComponent(catalogQuery)}&limit=8`
      : null,
  );

  // Merge local (holdings + seed) and live catalog suggestions into one list,
  // deduped by ticker (local wins so a "YOURS" tag is preserved). Catalog rows
  // carry the parent name + Acc/Div so the user can tell sibling classes apart.
  const suggestions = useMemo<CatalogSuggestion[]>(() => {
    const seen = new Set<string>();
    const out: CatalogSuggestion[] = [];
    for (const s of localSuggestions) {
      const key = s.ticker.trim().toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        ticker: s.ticker,
        name: s.name,
        quote_source: s.quote_source,
        fromHoldings: s.fromHoldings,
      });
    }
    for (const c of catalogMatches ?? []) {
      const key = c.ticker.trim().toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        ticker: c.ticker,
        name: c.englishName ?? c.thaiName ?? c.abbrName ?? c.ticker,
        quote_source: "thai_mutual_fund",
        distributionPolicy: c.distributionPolicy,
      });
    }
    return out;
  }, [localSuggestions, catalogMatches]);

  // Resolve cache, keyed by the UPPERCASED ticker string (not row index, which
  // shifts on merge/remove). Drives the "pick a class" warning and blocks save
  // for any row whose ticker is a bare parent. Shared across manual / paste /
  // image / seed entry — one validation per distinct symbol.
  const [resolveCache, setResolveCache] = useState<Record<string, ResolveResult>>({});

  // Validate a typed ticker against the catalog. A parent-with-classes result
  // flags every row carrying that symbol (warning + blocked save). Non-fund
  // tickers (stocks/indices) resolve `valid` and don't block. Cached per symbol.
  // Stable identity (no deps) so the resolve effect below doesn't re-run every
  // render — setResolveCache's updater reads prev, so it needs no closure deps.
  const resolveTicker = useCallback(async (raw: string) => {
    const ticker = raw.trim();
    if (!ticker) return;
    const key = ticker.toUpperCase();
    try {
      const res = await fetch(`/api/fund-classes/resolve?ticker=${encodeURIComponent(ticker)}`);
      if (!res.ok) return;
      const result = (await res.json()) as ResolveResult;
      setResolveCache((prev) => ({ ...prev, [key]: result }));
    } catch {
      // Network hiccup — leave the symbol unflagged rather than blocking a valid save.
    }
  }, []);

  // Validate any table ticker not yet in the cache — covers the paste, CSV,
  // image, and seed paths in one place (manual entry also fires resolveTicker on
  // blur for immediacy). Debounced so a burst of pasted rows resolves once. The
  // cache guard makes re-runs idempotent (an edit to units/avgCost re-runs but
  // fetches nothing once every symbol is cached).
  useEffect(() => {
    const pending = Array.from(
      new Set(
        rows.map((r) => r.ticker.trim().toUpperCase()).filter((t) => t && !(t in resolveCache)),
      ),
    );
    if (pending.length === 0) return;
    const id = setTimeout(() => {
      for (const t of pending) void resolveTicker(t);
    }, 200);
    return () => clearTimeout(id);
  }, [rows, resolveCache, resolveTicker]);

  const parsePaste = (text: string = pasteText): Row[] => {
    const lines = text.split("\n").filter((l) => l.trim());
    return lines
      .map((line) => {
        const m = line.match(/^\s*([A-Z][A-Z0-9&-]*(?:\([A-Z0-9&]+\))?)/i);
        if (!m) return null;
        const ticker = m[1];
        const rest = line.slice(m[0].length);
        const hasCurrency = /(?:฿|THB\b|baht\b)/i.test(rest);
        const numbers = Array.from(rest.matchAll(/[\d,]+(?:\.\d+)?/g), (match) =>
          match[0].replace(/,/g, ""),
        );
        if (numbers.length === 0) {
          return { ticker, units: "", avgCost: "", needsUnits: true };
        }
        if (hasCurrency && numbers.length === 1) {
          return { ticker, units: "", avgCost: "", needsUnits: true };
        }
        return {
          ticker,
          units: numbers[0],
          avgCost: numbers[1] ?? "",
        };
      })
      .filter((r): r is Row => r !== null);
  };

  // Merge rows into the shared table by symbol. Incoming non-empty fields win
  // over an existing row (so a fund-detail screenshot backfills exact units
  // over an earlier summary, and paste fills avg cost). Blank placeholder rows
  // are dropped once real rows exist. Original order is kept; new tickers
  // append at the end.
  const mergeRows = (prev: Row[], incoming: Row[], provenance?: Row["provenance"]) => {
    const clean = incoming.filter((r) => r.ticker.trim());
    if (clean.length === 0) return prev;
    const byTicker = new Map<string, Row>();
    const order: string[] = [];
    const upsert = (r: Row, incomingProvenance?: Row["provenance"]) => {
      const k = r.ticker.trim().toUpperCase();
      if (!k) return;
      const existing = byTicker.get(k);
      if (!existing) order.push(k);
      byTicker.set(k, {
        ticker: r.ticker || existing?.ticker || "",
        units: r.units || existing?.units || "",
        avgCost: r.avgCost || existing?.avgCost || "",
        provenance:
          incomingProvenance === "image"
            ? "image"
            : (existing?.provenance ?? r.provenance ?? incomingProvenance),
        englishName: r.englishName ?? existing?.englishName,
        // An explicit (locked) per-row choice wins; otherwise carry whichever
        // side has one so the type pill stays correct across merges.
        quoteSource: r.quoteSourceLocked
          ? r.quoteSource
          : existing?.quoteSourceLocked
            ? existing.quoteSource
            : (r.quoteSource ?? existing?.quoteSource),
        quoteSourceLocked: r.quoteSourceLocked || existing?.quoteSourceLocked,
        // A freshly-supplied units clears the needs-units flag.
        estimated: r.estimated ?? existing?.estimated,
        needsUnits: r.units || existing?.units ? false : (r.needsUnits ?? existing?.needsUnits),
      });
    };
    for (const r of prev) if (r.ticker.trim()) upsert(r);
    for (const r of clean) upsert(r, provenance);
    return order.map((k) => byTicker.get(k) as Row);
  };

  const appendRows = (incoming: Row[], provenance?: Row["provenance"]) => {
    // Detect transaction-shape on the PRE-MERGE rows (mergeRows would dedup the
    // repeated tickers that signal a ledger).
    if (looksLikeTransactionHistory(incoming.filter((r) => r.ticker.trim()))) {
      setTxnShapeDetected(true);
    }
    setRows((prev) => mergeRows(prev, incoming, provenance));
  };

  const stagePastedRows = (text: string, silent = false) => {
    const parsed = parsePaste(text);
    setPasteParseCount(parsed.length);
    if (looksLikeTransactionHistory(parsed.filter((r) => r.ticker.trim()))) {
      setTxnShapeDetected(true);
    }
    if (parsed.length === 0) {
      if (!silent) {
        setSubmitError("Couldn't parse any rows — check the format (SYMBOL + quantity per line).");
      }
      return;
    }
    setRows((prev) =>
      mergeRows(
        prev.filter((r) => r.provenance !== "paste"),
        parsed,
        "paste",
      ),
    );
    setSubmitError(null);
  };

  // Paste tab: parse the textarea and append parsed rows to the table.
  // `silent` (used by the auto-parse-on-blur/paste path) skips the error toast
  // when nothing parses yet — mid-typing or an empty blur shouldn't nag.
  const addPastedRows = (silent = false) => {
    stagePastedRows(pasteText, silent);
  };

  // Format a derived number for an editable text field: trim float noise,
  // keep it human-typable. Empty string for missing values.
  const fmtNum = (n: number | undefined): string => {
    if (n === undefined || !Number.isFinite(n)) return "";
    // Round to 4 dp (NAV/quantity precision) but drop trailing zeros.
    return String(Math.round(n * 1e4) / 1e4);
  };

  // Map a derived/extracted row (from the image API or the in-chat importer) to
  // an editable table Row. Shared by the image-upload path and the chat-seed
  // effect so both backfill units/avgCost and the estimated/needs-units flags
  // identically. Keeps the server-derived quoteSource; falls back to a local
  // inference. Not locked — editing the ticker re-infers.
  const importedRowToRow = (ir: ImportedRow): Row => {
    const ticker = ir.ticker.trim();
    return {
      ticker,
      units: fmtNum(ir.units),
      avgCost: fmtNum(ir.avgCost),
      provenance: "image",
      englishName: ir.englishName,
      quoteSource: ir.quoteSource ?? inferQuoteSource(ticker),
      estimated: ir.estimated,
      needsUnits: ir.needsUnits,
    };
  };

  // Extract holdings from one or more screenshots. Each image hits the
  // structured endpoint independently; rows are merged (deduped by symbol —
  // a later image's row wins, since users often upload the detail view after
  // the summary to add exact quantity). Estimated / needs-units flags ride along
  // so the confirmation table can mark them.
  const handleImages = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Allow re-uploading the same file later.
    e.target.value = "";
    if (files.length === 0) return;

    // Local previews immediately, regardless of extraction latency.
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

    const extracted: Row[] = [];
    let anyFail = false;
    let anyRow = false;
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append("image", file);
        const res = await fetch("/api/import/image", { method: "POST", body: fd });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as OcrErrorResponse | null;
          setOcrError(body?.message ?? `Couldn't read ${file.name} (${res.status})`);
          anyFail = true;
          continue;
        }
        const body = (await res.json()) as ImportApiResponse;
        for (const ir of body.rows ?? []) {
          if (!ir.ticker.trim()) continue;
          anyRow = true;
          extracted.push(importedRowToRow(ir));
        }
      } catch (err) {
        setOcrError(err instanceof Error ? err.message : "Failed to reach the import endpoint.");
        anyFail = true;
      }
    }

    appendRows(extracted, "image");
    if (!anyRow && !anyFail) {
      setOcrError(
        "Couldn't find any holdings in this image. Try a sharper screenshot, or type rows in the table below.",
      );
    }
    setImgProcessing(false);
  };

  const removeImage = (idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx));

  // Clear uploaded screenshots + any extraction error. The shared table is left
  // intact (rows from paste/typing shouldn't vanish when clearing images).
  const clearImages = () => {
    setImages([]);
    setOcrError(null);
    setImgProcessing(false);
  };

  // Seed rows handed in by the Advisor's in-chat holdings table. Merge them into
  // the shared confirmation table exactly like an image extract, switching to the
  // Image tab so the estimated/needs-units affordances read naturally. Consumed
  // once per array identity (App passes a fresh array per request), so unrelated
  // re-renders don't re-append.
  const seededRef = useRef<ImportSeedRow[] | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: appendRows/importedRowToRow
  // are recreated each render; the ref guard makes them safe to omit (re-running
  // on every render would otherwise re-append). Mirrors the consume-once pattern
  // used for seedPrompt in ChatScreen.
  useEffect(() => {
    if (!open || !seedRows || seedRows.length === 0) return;
    if (seededRef.current === seedRows) return;
    seededRef.current = seedRows;
    setMethod("image");
    appendRows(seedRows.map(importedRowToRow), "image");
  }, [open, seedRows]);

  const submit = async () => {
    if (!bucketId) {
      setSubmitError("Pick a portfolio first");
      return;
    }
    // Block any row whose ticker is a bare parent with multiple share classes —
    // it has no NAV of its own, so it can't be priced. The user must pick a class.
    const blockedTickers = Array.from(
      new Set(
        rows
          .filter((r) => resolveCache[r.ticker.trim().toUpperCase()]?.isParentWithClasses)
          .map((r) => r.ticker.trim()),
      ),
    );
    if (blockedTickers.length > 0) {
      setSubmitError(
        `Pick a share class for ${blockedTickers.join(", ")} — these are parent funds with multiple classes and no price of their own.`,
      );
      return;
    }

    // One shared table feeds the save, regardless of how rows got there.
    const toAdd = rows.filter((r) => r.ticker && r.units);

    if (toAdd.length === 0) {
      setSubmitError("No valid rows to add");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      for (const row of toAdd) {
        const units = Number.parseFloat(row.units) || 0;
        const avgCost = row.avgCost ? Number.parseFloat(row.avgCost) || 0 : 0;
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
            source: source.trim() || null,
            // Per-row source (explicit pill choice, import, or live inference).
            quoteSource: row.quoteSource ?? inferQuoteSource(row.ticker),
          }),
        });
        if (!res.ok) throw new Error(`Add ${ticker} failed (${res.status})`);
      }
      invalidate(/^\/api\/holdings/);
      onAdd(
        toAdd.map((t) => ({
          ticker: t.ticker,
          units: t.units,
          avgCost: t.avgCost,
          source,
          addedAt: Date.now(),
        })),
      );
      setPasteText("");
      setPasteParseCount(null);
      setRows([
        { ticker: "", units: "", avgCost: "" },
        { ticker: "", units: "", avgCost: "" },
      ]);
      setTxnShapeDetected(false);
      setScopeGuardDismissed(false);
      clearImages();
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
      const next = (looksLikeHeader ? lines.slice(1) : lines).join("\n");
      setPasteText(next);
      stagePastedRows(next, true);
    };
    reader.readAsText(file);
    // Allow re-uploading the same file
    e.target.value = "";
  };

  const updateRow = (i: number, field: keyof Row, val: string) => {
    const copy = [...rows];
    copy[i] = { ...copy[i], [field]: val };
    // If the user edits the ticker by typing, clear any remembered englishName
    // — it no longer matches what they have in the field — and let the type
    // pill re-infer (unless the user pinned the source explicitly).
    if (field === "ticker") {
      copy[i].englishName = undefined;
      if (!copy[i].quoteSourceLocked) copy[i].quoteSource = undefined;
      // The resolve cache is keyed by symbol, so the edited row simply reads the
      // new symbol's cached result (or triggers a fresh resolve via the effect /
      // blur) — no per-row cleanup needed.
    }
    // Supplying quantity clears the "needs quantity" flag on an image-derived row.
    if (field === "units" && val.trim()) copy[i].needsUnits = false;
    setRows(copy);
  };

  const setRowQuoteSource = (i: number, next: QuoteSource) => {
    const copy = [...rows];
    copy[i] = { ...copy[i], quoteSource: next, quoteSourceLocked: true };
    setRows(copy);
  };

  const pickSuggestion = (i: number, s: CatalogSuggestion) => {
    const copy = [...rows];
    // The catalog entry carries an authoritative source — adopt it for the row.
    copy[i] = { ...copy[i], ticker: s.ticker, englishName: s.name, quoteSource: s.quote_source };
    setRows(copy);
    setOpenSuggestRow(null);
    // A picked suggestion is a real priceable class — validate it so its (valid)
    // result lands in the cache; the resolve effect would catch it too.
    void resolveTicker(s.ticker);
  };

  const addRow = () => setRows([...rows, { ticker: "", units: "", avgCost: "" }]);
  const removeRow = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  // Scope-guard: did the imported input look like a transaction history (the
  // same fund repeated, i.e. a buy/sell log) rather than a holdings snapshot? If
  // so, nudge the user toward the transaction importer. Light-touch — never
  // blocks. NOTE: this is detected on the PRE-MERGE rows (see stagePastedRows /
  // appendRows), because mergeRows collapses repeated tickers into one row —
  // checking the merged table would never see the repeat that signals a ledger.
  const txnShaped = !!onSwitchToTransactions && txnShapeDetected && !scopeGuardDismissed;
  const switchToTransactions = () => {
    // Hand off DISTINCT ticker stubs only — the holdings table merges rows by
    // ticker, so its units/cost are not per-trade figures. The user re-enters
    // dates, types, and amounts in the transaction sheet (which is the point).
    const seen = new Set<string>();
    const seed: ExtractedTxnRow[] = [];
    for (const r of rows) {
      const ticker = r.ticker.trim();
      const key = ticker.toUpperCase();
      if (!ticker || seen.has(key)) continue;
      seen.add(key);
      seed.push({ ticker });
    }
    onSwitchToTransactions?.(seed.length > 0 ? seed : null);
  };

  // The shared table is the single source of truth for what will be saved.
  const previewCount = rows.filter((r) => r.ticker && r.units).length;
  // Any row still pointing at a bare parent (multiple share classes) blocks the
  // whole save — the user must resolve it to a priceable class first.
  const hasBlockedRow = rows.some(
    (r) => resolveCache[r.ticker.trim().toUpperCase()]?.isParentWithClasses,
  );
  const needsUnitsCount = rows.filter((r) => r.ticker.trim() && !r.units.trim()).length;
  const unknownSymbolCount = rows.filter((r, i) => {
    const ticker = r.ticker.trim();
    return ticker && openSuggestRow !== i && !knownTickerSet.has(ticker.toUpperCase());
  }).length;

  // Renders the Modal CONTENTS only — the single <Modal> shell is owned by
  // AddToPortfolioSheet so the Holdings↔Activity toggle swaps the body without
  // changing the modal's chrome or width. Must be rendered inside a <Modal>.
  return (
    <>
      <Modal.Header
        title="Add to portfolio"
        subtitle="A snapshot of what you hold now, from any Thai brokerage. Read-only — we never trade for you."
        id="ah-title"
      >
        {modeToggle}
      </Modal.Header>
      <Modal.Body>
        {txnShaped && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              marginBottom: 14,
              borderRadius: 8,
              background: "var(--accent-soft, rgba(0,0,0,0.04))",
              border: "1px solid var(--line-soft)",
            }}
          >
            <Icon name="info" size={15} />
            <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
              This looks like a transaction history — the same fund appears more than once. The
              Holdings importer records what you hold <em>now</em>; to track buys, sells, realized
              gains and return, use the Transaction log instead.
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button className="btn primary sm" onClick={switchToTransactions}>
                  Open Transaction log
                </button>
                <button className="btn ghost sm" onClick={() => setScopeGuardDismissed(true)}>
                  Import as a snapshot anyway
                </button>
              </div>
            </div>
          </div>
        )}
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
            <input
              list="add-source-suggestions"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Type or pick a source"
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
            />
            <datalist id="add-source-suggestions">
              {sourceOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
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
                "e.g.\nK-USA-A: 8,945 units\nSCBS&P500: 12,450 units\nK-FIXED-A, 14820, 12.04 avg cost"
              }
              value={pasteText}
              onChange={(e) => {
                setPasteText(e.target.value);
                setPasteParseCount(null);
              }}
              // Auto-parse the instant the user pastes — the common case, and
              // predictable (no invisible "click away to process"). Preserve
              // the raw text so the table is reviewable against the source; the
              // button re-parses/replaces paste-derived rows if the user edits it.
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (!pasted.trim()) return;
                e.preventDefault();
                const target = e.currentTarget;
                const start = target.selectionStart ?? target.value.length;
                const end = target.selectionEnd ?? target.value.length;
                const next = `${target.value.slice(0, start)}${pasted}${target.value.slice(end)}`;
                setPasteText(next);
                stagePastedRows(next, true);
              }}
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
              {pasteParseCount === null
                ? "ⓘ SYMBOL + quantity · avg cost optional · one per line"
                : pasteParseCount > 0
                  ? `✓ Added ${pasteParseCount} row${pasteParseCount > 1 ? "s" : ""} to the table`
                  : "ⓘ No rows added yet · check symbol + quantity format"}
            </div>
            {pasteText.trim() && (
              <button
                type="button"
                className="btn ghost sm full"
                onClick={() => addPastedRows()}
                style={{ marginTop: 8 }}
              >
                <Icon name="plus" size={12} />{" "}
                {pasteParseCount && pasteParseCount > 0 ? "Update table" : "Add rows to table"}
              </button>
            )}
          </div>
        )}

        {method === "image" && (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={handleImages}
            />

            {images.length === 0 ? (
              <>
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
                  <div className="dz-title">Drop your portfolio screenshot(s)</div>
                  <div className="dz-sub">
                    or tap to browse · add more than one · we&apos;ll pull out the holdings
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
                    <strong style={{ fontWeight: 500 }}>How it works: </strong>your screenshot is
                    read by AI just long enough to pull out the rows, then discarded — it&apos;s
                    never stored. You review and edit every row before anything is saved.
                  </span>
                </div>
              </>
            ) : (
              <>
                {/* Preview thumbnails for each uploaded screenshot. */}
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginBottom: 12,
                  }}
                >
                  {images.map((img, idx) => (
                    <div
                      key={`${img.name}-${idx}`}
                      style={{
                        position: "relative",
                        width: 72,
                        height: 72,
                        borderRadius: 10,
                        overflow: "hidden",
                        border: "1px solid var(--line-soft)",
                        flexShrink: 0,
                      }}
                    >
                      <img
                        src={img.preview}
                        alt={img.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        aria-label={`Remove ${img.name}`}
                        style={{
                          position: "absolute",
                          top: 2,
                          right: 2,
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          border: "none",
                          background: "rgba(0,0,0,0.6)",
                          color: "white",
                          cursor: "pointer",
                          display: "grid",
                          placeItems: "center",
                          fontSize: 11,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    aria-label="Add another image"
                    disabled={imgProcessing}
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 10,
                      border: "1px dashed var(--line)",
                      background: "var(--card-soft)",
                      color: "var(--muted)",
                      cursor: imgProcessing ? "default" : "pointer",
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="plus" size={16} />
                  </button>
                </div>

                {imgProcessing && (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      marginBottom: 10,
                      fontSize: 12,
                      color: "var(--muted)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    <div className="typing">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                    Reading your holdings…
                  </div>
                )}

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

                {!imgProcessing && !ocrError && previewCount > 0 && (
                  <div
                    style={{
                      marginBottom: 8,
                      fontSize: 11.5,
                      color: "var(--accent-ink)",
                      lineHeight: 1.45,
                    }}
                  >
                    ✓ Added to the table below — review and edit before saving.
                  </div>
                )}

                <button className="btn ghost sm full" onClick={clearImages}>
                  Clear images
                </button>
              </>
            )}
          </div>
        )}

        {/* Shared confirmation table: Paste/Image append rows here, and users
            can also type directly into it. One Save commits the reviewed set. */}
        <div style={{ marginTop: 20 }}>
          {rows.length > 0 && (
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
              <span style={{ padding: "0 10px" }}>Symbol</span>
              <span style={{ padding: "0 10px" }}>Quantity</span>
              <span style={{ padding: "0 10px" }}>Avg cost</span>
              <span></span>
            </div>
          )}
          {rows.map((r, i) => {
            const hasTicker = Boolean(r.ticker.trim());
            const rowNeedsUnits = hasTicker && !r.units.trim();
            // Hold back the empty-quantity amber while the user is editing any
            // field in this row — only flag it once they leave it incomplete.
            const showNeedsUnits = rowNeedsUnits && activeRow !== i;
            const unknownTicker =
              hasTicker &&
              openSuggestRow !== i &&
              !knownTickerSet.has(r.ticker.trim().toUpperCase());
            const openSuggestionsUp = i >= Math.max(0, rows.length - 2);
            const rowSource: QuoteSource = r.quoteSource ?? inferQuoteSource(r.ticker);
            // A typed bare-parent ticker (e.g. "MDIVA") that has multiple share
            // classes isn't priceable — flag the row and block its save until the
            // user picks a real class.
            const flag = resolveCache[r.ticker.trim().toUpperCase()];
            const parentFlag = flag?.isParentWithClasses ? flag : null;
            return (
              <div key={i}>
                <div
                  className="manual-row"
                  // Track row-level focus (focusin/focusout bubble) so the
                  // needs-quantity amber waits until focus leaves the whole row.
                  onFocus={() => setActiveRow(i)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setActiveRow((cur) => (cur === i ? null : cur));
                    }
                  }}
                >
                  <div style={{ position: "relative" }}>
                    <input
                      placeholder="Symbol"
                      value={r.ticker}
                      onChange={(e) => updateRow(i, "ticker", e.target.value)}
                      onFocus={() => setOpenSuggestRow(i)}
                      // Delay clearing so a click on the dropdown lands before blur
                      // kills it; validate the typed symbol against the catalog so
                      // a bare parent gets flagged before save.
                      onBlur={() => {
                        const typed = r.ticker;
                        setTimeout(() => setOpenSuggestRow((cur) => (cur === i ? null : cur)), 120);
                        void resolveTicker(typed);
                      }}
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={openSuggestRow === i && suggestions.length > 0}
                      aria-controls={`ticker-suggest-${i}`}
                      autoComplete="off"
                      // Full ticker on hover — the input clips long codes (fade cue below).
                      title={
                        hasTicker
                          ? unknownTicker
                            ? `${r.ticker} — not in catalog`
                            : r.ticker
                          : undefined
                      }
                      aria-invalid={Boolean(parentFlag)}
                      style={{
                        // Reserve room for the in-input price-source badge.
                        ...(hasTicker ? { paddingRight: 42 } : null),
                        ...(unknownTicker || parentFlag
                          ? { borderColor: "var(--amber)", background: "var(--card-soft)" }
                          : null),
                      }}
                    />
                    {/* Right-edge fade: cues "more text" when a long symbol clips
                      before the badge. Only visible when text reaches the zone. */}
                    {hasTicker && <span className="symbol-fade" aria-hidden="true" />}
                    {hasTicker && (
                      <button
                        type="button"
                        className="type-badge"
                        data-overridden={Boolean(r.quoteSourceLocked)}
                        title="Price source — tap to switch (Thai fund ⇄ Stock / ETF)"
                        onClick={() =>
                          setRowQuoteSource(
                            i,
                            rowSource === "thai_mutual_fund" ? "yahoo" : "thai_mutual_fund",
                          )
                        }
                      >
                        {TYPE_BADGE_CODES[rowSource]}
                      </button>
                    )}
                    {openSuggestRow === i && suggestions.length > 0 && (
                      <div
                        id={`ticker-suggest-${i}`}
                        role="listbox"
                        style={{
                          position: "absolute",
                          top: openSuggestionsUp ? undefined : "calc(100% + 2px)",
                          bottom: openSuggestionsUp ? "calc(100% + 2px)" : undefined,
                          left: 0,
                          right: 0,
                          zIndex: 80,
                          margin: 0,
                          padding: 4,
                          background: "var(--paper)",
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
                                {s.distributionPolicy === "accumulating" && (
                                  <span
                                    style={{
                                      marginLeft: 6,
                                      fontSize: 9.5,
                                      color: "var(--accent-ink)",
                                      letterSpacing: "0.04em",
                                    }}
                                  >
                                    · ACC
                                  </span>
                                )}
                                {s.distributionPolicy === "dividend" && (
                                  <span
                                    style={{
                                      marginLeft: 6,
                                      fontSize: 9.5,
                                      color: "var(--accent-ink)",
                                      letterSpacing: "0.04em",
                                    }}
                                  >
                                    · DIV
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
                    placeholder="Quantity"
                    value={r.units}
                    onChange={(e) => updateRow(i, "units", e.target.value)}
                    aria-invalid={showNeedsUnits}
                    title={
                      rowNeedsUnits
                        ? "No quantity on the screenshot — open the fund in your broker app (or its detail screen) for exact units + avg cost, then type them here."
                        : r.estimated
                          ? "Estimated from value ÷ NAV — edit for an exact quantity"
                          : undefined
                    }
                    style={
                      showNeedsUnits
                        ? {
                            borderColor: "var(--amber)",
                            background: "color-mix(in oklab, var(--amber) 10%, transparent)",
                          }
                        : r.estimated
                          ? { borderStyle: "dashed" }
                          : undefined
                    }
                  />
                  <input
                    placeholder="Optional"
                    title="Avg cost per unit (optional)"
                    value={r.avgCost}
                    onChange={(e) => updateRow(i, "avgCost", e.target.value)}
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
                {parentFlag && (
                  <div
                    role="alert"
                    style={{
                      margin: "2px 10px 6px",
                      padding: "7px 10px",
                      background: "color-mix(in oklab, var(--amber) 12%, transparent)",
                      border: "1px solid var(--amber)",
                      borderRadius: 8,
                      fontSize: 11.5,
                      color: "var(--ink-soft)",
                      lineHeight: 1.45,
                    }}
                  >
                    <strong style={{ fontWeight: 600 }}>{r.ticker.trim()}</strong> has multiple
                    share classes — pick one:{" "}
                    <span style={{ fontFamily: "var(--font-mono)" }}>
                      {(parentFlag.classes ?? []).map((c) => c.ticker).join(", ")}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ marginTop: 6 }}>
            <button className="btn ghost sm" onClick={addRow}>
              <Icon name="plus" size={12} /> Add row
            </button>
          </div>
          {(needsUnitsCount > 0 || unknownSymbolCount > 0) && (
            <div
              style={{
                marginTop: 8,
                fontSize: 11,
                color: "var(--muted)",
                lineHeight: 1.45,
              }}
            >
              {needsUnitsCount > 0 && unknownSymbolCount > 0
                ? `ⓘ ${needsUnitsCount} ${needsUnitsCount > 1 ? "rows need" : "row needs"} a quantity · ${unknownSymbolCount} ${unknownSymbolCount > 1 ? "symbols" : "symbol"} not in catalog (you can still save).`
                : needsUnitsCount > 0
                  ? `ⓘ ${needsUnitsCount} ${needsUnitsCount > 1 ? "rows need" : "row needs"} a quantity.`
                  : `ⓘ ${unknownSymbolCount} ${unknownSymbolCount > 1 ? "symbols" : "symbol"} not in catalog (you can still save).`}
            </div>
          )}
          {rows.some((r) => r.ticker.trim()) && (
            <div
              style={{
                marginTop: 10,
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                fontSize: 11.5,
                color: "var(--muted)",
                lineHeight: 1.4,
              }}
            >
              <span>Set all to:</span>
              <div className="source-seg">
                {SOURCE_SEG_ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    title={`Set every row's price source to ${SOURCE_SEG_LABELS[s]}`}
                    onClick={() =>
                      setRows((prev) =>
                        prev.map((r) =>
                          r.ticker.trim() ? { ...r, quoteSource: s, quoteSourceLocked: true } : r,
                        ),
                      )
                    }
                  >
                    {SOURCE_SEG_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

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
            <strong style={{ fontWeight: 500 }}>Or ask the advisor: </strong>say &quot;Add 50k of
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
      </Modal.Body>
      <Modal.Footer>
        <button type="button" className="btn ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={submit}
          disabled={previewCount === 0 || submitting || !bucketId || hasBlockedRow}
        >
          {submitting
            ? "Adding…"
            : previewCount > 0
              ? `Add ${previewCount} holding${previewCount > 1 ? "s" : ""}`
              : "Add holdings"}
          <Icon name="check" size={13} />
        </button>
      </Modal.Footer>
    </>
  );
}
