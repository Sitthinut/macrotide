// Curated list of market indices we surface on MarketsScreen.
// All symbols come from Yahoo Finance and require no API key.

export interface IndexDef {
  symbol: string;
  label: string;
  /** Short display name (under the ticker). */
  name: string;
  /** True when the value should be rendered as basis points or a percent. */
  isYield?: boolean;
}

export const INDICES: IndexDef[] = [
  { symbol: "^SET.BK", label: "SET", name: "Stock Exchange of Thailand" },
  { symbol: "^GSPC", label: "S&P 500", name: "US large-cap" },
  { symbol: "^IXIC", label: "Nasdaq", name: "US tech-heavy" },
  { symbol: "^N225", label: "Nikkei", name: "Japan large-cap" },
  { symbol: "THB=X", label: "USD/THB", name: "Currency" },
];
