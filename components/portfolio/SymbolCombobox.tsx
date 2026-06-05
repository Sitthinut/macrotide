"use client";

// SymbolCombobox — the fund/ticker autocomplete, composed from the shared
// Combobox. Same behavior as the original AddHoldingsSheet symbol field: the
// user's own holdings + the static seed surface first, then live priceable
// SHARE CLASSES from the SEC catalog (GET /api/fund-classes, ≥2 chars), each
// tagged "· YOURS" / "· ACC" / "· DIV" so sibling classes are distinguishable.
// The in-input price-source badge (TH ⇄ ETF) rides along.

import { useEffect, useMemo, useState } from "react";
import { Combobox } from "@/components/ui/Combobox";
import { filterKnownTickers, type TickerSuggestion } from "@/lib/data/known-funds";
import type { ShareClassListItem } from "@/lib/db/queries/funds";
import { useResource } from "@/lib/fetchers/swr";
import { inferQuoteSource } from "@/lib/market/infer-quote-source";
import type { QuoteSource } from "@/lib/market/sources";

// Short labels for the in-input price-source badge — the asset class, not the
// provider. "Fund" reads clearer than "TH" for a Thai mutual fund.
const TYPE_BADGE_CODES: Record<QuoteSource, string> = {
  thai_mutual_fund: "Fund",
  yahoo: "ETF",
  manual: "Custom",
};

// One dropdown row — a local (holdings/seed) suggestion or a live catalog class.
// `distributionPolicy` is present only for catalog rows (drives the Acc/Div tag).
interface SymbolSuggestion {
  ticker: string;
  name: string;
  quoteSource: QuoteSource;
  fromHoldings?: boolean;
  distributionPolicy?: string | null;
}

export interface SymbolPick {
  ticker: string;
  name?: string;
  quoteSource: QuoteSource;
}

export interface SymbolComboboxProps {
  value: string;
  /** Explicit per-row source (a user toggle); when set, the badge reads "overridden". */
  quoteSource?: QuoteSource;
  /** Marks `quoteSource` as a deliberate choice (badge highlight) vs. an inference. */
  sourceLocked?: boolean;
  /** Merged local pool — the user's holdings + the static seed. */
  pool: TickerSuggestion[];
  onChange: (ticker: string) => void;
  onPick: (s: SymbolPick) => void;
  /** Flip the price source (Thai fund ⇄ Stock / ETF). */
  onToggleSource: () => void;
  openUp?: boolean;
}

export function SymbolCombobox({
  value,
  quoteSource,
  sourceLocked,
  pool,
  onChange,
  onPick,
  onToggleSource,
  openUp,
}: SymbolComboboxProps) {
  // Debounce the query so the filter + catalog fetch don't refire on every key.
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 120);
    return () => clearTimeout(t);
  }, [value]);
  const query = debounced.trim();

  const local = useMemo(() => (query ? filterKnownTickers(pool, query) : []), [pool, query]);

  // Live catalog autocomplete — real priceable share classes, ≥2 chars only.
  const { data: catalog } = useResource<ShareClassListItem[]>(
    query.length >= 2 ? `/api/fund-classes?query=${encodeURIComponent(query)}&limit=8` : null,
  );

  // Merge local + catalog, deduped by ticker (local wins so the "YOURS" tag holds).
  const items = useMemo<SymbolSuggestion[]>(() => {
    const seen = new Set<string>();
    const out: SymbolSuggestion[] = [];
    for (const s of local) {
      const key = s.ticker.trim().toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        ticker: s.ticker,
        name: s.name,
        quoteSource: s.quote_source,
        fromHoldings: s.fromHoldings,
      });
    }
    for (const c of catalog ?? []) {
      const key = c.ticker.trim().toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        ticker: c.ticker,
        name: c.englishName ?? c.thaiName ?? c.abbrName ?? c.ticker,
        quoteSource: "thai_mutual_fund",
        distributionPolicy: c.distributionPolicy,
      });
    }
    return out;
  }, [local, catalog]);

  const effective = quoteSource ?? inferQuoteSource(value);
  const hasTicker = value.trim().length > 0;

  return (
    <Combobox<SymbolSuggestion>
      value={value}
      onChange={onChange}
      onPick={(s) => onPick({ ticker: s.ticker, name: s.name, quoteSource: s.quoteSource })}
      items={items}
      getKey={(s) => `${s.quoteSource}:${s.ticker}`}
      label="Symbol"
      placeholder="Symbol"
      openUp={openUp}
      trailing={
        hasTicker ? (
          <>
            <span className="symbol-fade" aria-hidden="true" />
            <button
              type="button"
              className="type-badge"
              data-overridden={Boolean(sourceLocked)}
              title="Price source — tap to switch (Thai fund ⇄ Stock / ETF)"
              // Keep the input focused so the dropdown doesn't close on the tap.
              onMouseDown={(e) => e.preventDefault()}
              onClick={onToggleSource}
            >
              {TYPE_BADGE_CODES[effective]}
            </button>
          </>
        ) : undefined
      }
      renderItem={(s) => (
        <>
          <div className="combobox__option-ticker">
            {s.ticker}
            {s.fromHoldings && (
              <span className="combobox__option-tag" data-tone="muted">
                · YOURS
              </span>
            )}
            {s.distributionPolicy === "accumulating" && (
              <span className="combobox__option-tag" data-tone="accent">
                · ACC
              </span>
            )}
            {s.distributionPolicy === "dividend" && (
              <span className="combobox__option-tag" data-tone="accent">
                · DIV
              </span>
            )}
          </div>
          <div className="combobox__option-name">{s.name}</div>
        </>
      )}
    />
  );
}
