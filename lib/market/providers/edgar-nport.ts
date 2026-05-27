// SEC EDGAR N-PORT (Form NPORT-P) holdings provider.
//
// Source of underlying holdings for feeder-fund look-through. Every
// US-registered fund (incl. ETFs structured as RICs) files Form NPORT-P
// quarterly; the filing's primary_doc.xml lists every holding with name,
// CUSIP, ISIN, percent-of-NAV weight, and asset category.
//
// Why this and not the issuer's own CSV: iShares/VanEck holdings CSVs are
// Akamai bot-gated (a datacenter fetch gets an HTML challenge page, not CSV).
// EDGAR is official, free, and returns real data to a plain server-side GET —
// it only requires a User-Agent that declares a contact email (see below).
//
// Trade-off: NPORT-P is filed within ~60 days of each fiscal quarter end, so
// holdings are "as of" the last quarter — fine for an informational look-through
// (an S&P 500 / Nasdaq-100 basket barely moves quarter to quarter; we timestamp
// it with the report-period date).
//
// Flow (all free, all server-fetchable, tested live):
//   1. EFTS full-text search for the fund's EDGAR series id, date-windowed to
//      the last ~200 days, forms=NPORT-P → newest filing's accession number.
//   2. Fetch https://www.sec.gov/Archives/edgar/data/{registrantCik}/{acc}/primary_doc.xml
//   3. Parse <invstOrSec> blocks; sort by weight; keep the top N.

// ─── Types ──────────────────────────────────────────────────────────────────

/** A US fund whose NPORT-P holdings we can fetch. Keyed by the fund's own ISIN
 *  in EDGAR_FUNDS. cik is the REGISTRANT cik (used in the Archives path), which
 *  differs from the filing-agent cik in the accession number. */
export interface EdgarFundRef {
  /** Registrant CIK (the trust), used to build the Archives URL. */
  cik: string;
  /** EDGAR series id (e.g. "S000004310"), used to find the right filing. */
  seriesId: string;
  /** The fund's own ISIN, stored as the master identifier for display. */
  isin: string;
  /** Human-readable fund name. */
  displayName: string;
  /** Distinctive identifier that MUST appear (case-insensitive substring) in a
   *  master-fund name for this fund to be a match candidate. Disjoint across
   *  funds so a name can't be a candidate for two of them. Optional on the type
   *  so callers building ad-hoc refs need not supply it; every EDGAR_FUNDS
   *  entry has one (enforced by the registry test). */
  primaryKeyword?: string;
  /** Extra keywords to break ties between same-primary candidates. */
  keywords?: string[];
}

/** One parsed holding from a NPORT-P filing. */
export interface NportHolding {
  name: string;
  /** NPORT-P does not carry tickers — always null (ISIN/CUSIP identify it). */
  ticker: string | null;
  /** Human-readable asset class, mapped from the NPORT assetCat code. */
  assetClass: string | null;
  isin: string | null;
  cusip: string | null;
  /** Percent of NAV (already a percentage, e.g. 8.04 means 8.04%). */
  weightPct: number | null;
}

export interface NportResult {
  /** Report-period date (YYYY-MM-DD) the holdings are "as of", or null. */
  asOfDate: string | null;
  holdings: NportHolding[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

// SEC rejects requests whose User-Agent doesn't declare a contact (HTTP 403,
// "Your Request Originates from an Undeclared Automated Tool"). The format is
// "App/version contact-email". Override with SEC_EDGAR_USER_AGENT in prod to
// set a real contact address.
const DEFAULT_USER_AGENT = "Macrotide/1.0 admin@macrotide.app";
const EFTS_SEARCH = "https://efts.sec.gov/LATEST/search-index";
const ARCHIVES = "https://www.sec.gov/Archives/edgar/data";
// Look back far enough to always include the latest quarterly filing (filed
// within ~60 days of a quarter end, quarters 90 days apart).
const LOOKBACK_DAYS = 200;

function userAgent(): string {
  return process.env.SEC_EDGAR_USER_AGENT || DEFAULT_USER_AGENT;
}

// NPORT-P asset-category codes → human labels (raw code as fallback).
const ASSET_CAT_LABELS: Record<string, string> = {
  EC: "Equity (common)",
  EP: "Equity (preferred)",
  DBT: "Debt",
  ABS: "Asset-backed",
  MBS: "Mortgage-backed",
  RA: "Repurchase agreement",
  STIV: "Short-term investment",
  DCO: "Commodity derivative",
  DE: "Equity derivative",
  DFE: "Forward derivative",
  DIR: "Rate derivative",
  DCR: "Credit derivative",
  SN: "Structured note",
  LON: "Loan",
  COMM: "Commodity",
  RE: "Real estate",
};

// ─── Fund registry ──────────────────────────────────────────────────────────
// Master funds used by Thai feeder funds that are US-registered (file NPORT-P).
// CIK + seriesId verified live against SEC's company_tickers_mf.json and EFTS.
// Add entries (with a verified ISIN) as more feeders are mapped.
export const EDGAR_FUNDS: Record<string, EdgarFundRef> = {
  US4642872265: {
    cik: "1100663",
    seriesId: "S000004310",
    isin: "US4642872265",
    displayName: "iShares Core S&P 500 ETF",
    primaryKeyword: "s&p 500",
  },
  US4642863926: {
    cik: "1100663",
    seriesId: "S000021461",
    isin: "US4642863926",
    displayName: "iShares MSCI ACWI ETF",
    primaryKeyword: "acwi",
  },
  US46090E1038: {
    cik: "1067839",
    seriesId: "S000101292",
    isin: "US46090E1038",
    displayName: "Invesco QQQ Trust",
    primaryKeyword: "qqq",
  },
  US46138G6492: {
    cik: "1378872",
    seriesId: "S000069448",
    isin: "US46138G6492",
    displayName: "Invesco NASDAQ 100 ETF",
    primaryKeyword: "nasdaq 100",
  },
};

// ─── Master-name resolution ───────────────────────────────────────────────────

/**
 * Resolve a master-fund name string (the SEC-Thai `feederfund_master_fund`
 * field) to an EDGAR_FUNDS key (the fund's ISIN), conservatively. A fund is a
 * candidate only if the name contains its `primaryKeyword`; the winner is the
 * unique highest scorer (score = primary + matched `keywords`). Returns null
 * when there is no candidate or the top score is tied — callers should then
 * defer to an explicit feeder_master_map entry rather than guess.
 */
export function matchEdgarFund(masterName: string): string | null {
  const name = masterName.toLowerCase();
  let best: { isin: string; score: number } | null = null;
  let tied = false;
  for (const [isin, ref] of Object.entries(EDGAR_FUNDS)) {
    if (!ref.primaryKeyword || !name.includes(ref.primaryKeyword.toLowerCase())) continue;
    const extra = ref.keywords?.filter((k) => name.includes(k.toLowerCase())).length ?? 0;
    const score = 1 + extra;
    if (!best || score > best.score) {
      best = { isin, score };
      tied = false;
    } else if (score === best.score) {
      tied = true;
    }
  }
  return best && !tied ? best.isin : null;
}

// ─── XML parsing ──────────────────────────────────────────────────────────────

/**
 * Parse a NPORT-P primary_doc.xml into the top-N holdings by weight.
 * Tolerant string parsing (no XML lib): NPORT-P is a flat, stable schema and
 * the holdings can number in the thousands, so we scan <invstOrSec> blocks.
 */
export function parseNportXml(xml: string, topN = 50): NportResult {
  const asOfDate = (xml.match(/<repPdDate>([^<]+)<\/repPdDate>/) || [])[1]?.trim() || null;
  const holdings: NportHolding[] = [];
  const blocks = xml.split("<invstOrSec>").slice(1);
  for (const raw of blocks) {
    const end = raw.indexOf("</invstOrSec>");
    const seg = end >= 0 ? raw.slice(0, end) : raw;
    const tag = (t: string): string | null => {
      const m = seg.match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`));
      return m ? m[1].trim() : null;
    };
    const name = tag("name") || tag("title");
    if (!name) continue;
    const cusip = tag("cusip");
    const isin = (seg.match(/<isin\s+value="([^"]*)"/) || [])[1] || null;
    const pctRaw = tag("pctVal");
    const pct = pctRaw != null && pctRaw !== "" ? Number(pctRaw) : null;
    const catCode = tag("assetCat");
    holdings.push({
      name,
      ticker: null,
      assetClass: catCode ? (ASSET_CAT_LABELS[catCode] ?? catCode) : null,
      isin,
      cusip: cusip && cusip !== "N/A" ? cusip : null,
      weightPct: pct != null && Number.isFinite(pct) ? pct : null,
    });
  }
  holdings.sort((a, b) => (b.weightPct ?? -1) - (a.weightPct ?? -1));
  return { asOfDate, holdings: holdings.slice(0, topN) };
}

// ─── Fetch ──────────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch the latest NPORT-P holdings for an EDGAR fund. Returns an empty result
 * (never throws) on any lookup/fetch/parse failure so the nightly crawl is
 * never aborted by one fund.
 */
export async function fetchNportHoldings(
  ref: EdgarFundRef,
  opts: { topN?: number } = {},
): Promise<NportResult> {
  const topN = opts.topN ?? 50;
  const empty: NportResult = { asOfDate: null, holdings: [] };
  try {
    const end = new Date();
    const start = new Date(end.getTime() - LOOKBACK_DAYS * 86_400_000);
    const q = encodeURIComponent(`"${ref.seriesId}"`);
    const url = `${EFTS_SEARCH}?q=${q}&forms=NPORT-P&startdt=${ymd(start)}&enddt=${ymd(end)}`;
    const search = (await fetchJson(url)) as {
      hits?: { hits?: Array<{ _source?: { adsh?: string; file_date?: string } }> };
    } | null;
    const hits = search?.hits?.hits ?? [];
    if (hits.length === 0) return empty;
    // EFTS sorts by relevance, not date — pick the newest filing ourselves.
    hits.sort((a, b) => (b._source?.file_date ?? "").localeCompare(a._source?.file_date ?? ""));
    const adsh = hits[0]?._source?.adsh;
    if (!adsh) return empty;

    const acc = adsh.replace(/-/g, "");
    const xmlRes = await fetch(`${ARCHIVES}/${ref.cik}/${acc}/primary_doc.xml`, {
      headers: { "User-Agent": userAgent() },
      cache: "no-store",
    });
    if (!xmlRes.ok) return empty;
    return parseNportXml(await xmlRes.text(), topN);
  } catch {
    return empty;
  }
}
