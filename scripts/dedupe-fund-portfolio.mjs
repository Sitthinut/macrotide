// One-time cleanup for the fund_portfolio duplication bug.
//
// Background: the SEC /outstanding feed sends `period` as a JSON number, which
// was bound to the TEXT column as "202406.0". The incremental-ingest guard
// compared a Set of stored STRINGS against the incoming NUMBER, never matched,
// and re-inserted the whole portfolio on every nightly crawl — leaving every
// row duplicated once per crawl (observed 6×, ~4.3M rows vs ~700k real). The
// code fix (normalizePeriod in lib/db/queries/fund-enrichment.ts) stops new
// duplicates; this script heals the data already on disk.
//
// It does two things, in one transaction:
//   1. Normalizes `period` to a clean "YYYYMM" string ("202406.0" → "202406")
//      in fund_portfolio AND fund_portfolio_asset_type.
//   2. Collapses exact-duplicate fund_portfolio rows — identical in EVERY column
//      except the surrogate id — keeping the lowest id of each group. Distinct
//      securities (different isin/issue_code/percent_nav) are never merged.
//
// Dry-run by default (prints what it WOULD do). Pass --apply to mutate.
//   MARKET_DB_PATH=/opt/services/macrotide/data/market.db node scripts/dedupe-fund-portfolio.mjs
//   ... node scripts/dedupe-fund-portfolio.mjs --apply
//
// Idempotent: re-running after a successful --apply is a no-op (already clean).

import { resolve } from "node:path";
import Database from "better-sqlite3";

const APPLY = process.argv.includes("--apply");
const DB_PATH = resolve(process.env.MARKET_DB_PATH ?? "data/market.db");

// Every fund_portfolio column except the surrogate id. Grouping on all of them
// means only rows that are byte-identical (including NULLs, which GROUP BY
// treats as equal) collapse — never two genuinely different holdings.
const CONTENT_COLS = [
  "proj_id",
  "period",
  "as_of_date",
  "assetliab_id",
  "assetliab_desc",
  "issue_code",
  "isin_code",
  "issuer",
  "assetliab_value",
  "percent_nav",
  "last_upd_date",
];

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const count = (sql, ...args) =>
  db
    .prepare(sql)
    .pluck()
    .get(...args);

const before = {
  portfolioTotal: count("SELECT COUNT(*) FROM fund_portfolio"),
  portfolioDistinct: count(
    `SELECT COUNT(*) FROM (SELECT 1 FROM fund_portfolio GROUP BY ${CONTENT_COLS.join(", ")})`,
  ),
  dottyPortfolio: count("SELECT COUNT(*) FROM fund_portfolio WHERE period LIKE '%.0'"),
  dottyAssetType: count("SELECT COUNT(*) FROM fund_portfolio_asset_type WHERE period LIKE '%.0'"),
};

console.log(`DB: ${DB_PATH}`);
console.log(`Mode: ${APPLY ? "APPLY (will mutate)" : "DRY-RUN (no changes)"}`);
console.log("");
console.log("fund_portfolio:");
console.log(`  total rows        : ${before.portfolioTotal.toLocaleString()}`);
console.log(`  distinct (logical): ${before.portfolioDistinct.toLocaleString()}`);
console.log(
  `  duplicate rows    : ${(before.portfolioTotal - before.portfolioDistinct).toLocaleString()} ` +
    `(${(before.portfolioTotal / Math.max(before.portfolioDistinct, 1)).toFixed(2)}× inflation)`,
);
console.log(`  rows w/ "…​.0" period: ${before.dottyPortfolio.toLocaleString()}`);
console.log(`fund_portfolio_asset_type:`);
console.log(`  rows w/ "….0" period: ${before.dottyAssetType.toLocaleString()}`);
console.log("");

if (!APPLY) {
  console.log("Dry-run only. Re-run with --apply to normalize periods and remove duplicates.");
  db.close();
  process.exit(0);
}

const run = db.transaction(() => {
  // 1. Normalize period: "202406.0" → "202406" (CAST via INTEGER drops the .0;
  //    a clean "202406" round-trips unchanged, so this is safe to apply to all).
  db.prepare("UPDATE fund_portfolio SET period = CAST(CAST(period AS INTEGER) AS TEXT)").run();
  db.prepare(
    "UPDATE fund_portfolio_asset_type SET period = CAST(CAST(period AS INTEGER) AS TEXT)",
  ).run();

  // 2. Collapse exact duplicates, keeping the lowest id per identical group.
  const del = db
    .prepare(
      `DELETE FROM fund_portfolio WHERE id NOT IN (
         SELECT MIN(id) FROM fund_portfolio GROUP BY ${CONTENT_COLS.join(", ")}
       )`,
    )
    .run();
  return del.changes;
});

const deleted = run();

const after = {
  portfolioTotal: count("SELECT COUNT(*) FROM fund_portfolio"),
  dottyPortfolio: count("SELECT COUNT(*) FROM fund_portfolio WHERE period LIKE '%.0'"),
  dottyAssetType: count("SELECT COUNT(*) FROM fund_portfolio_asset_type WHERE period LIKE '%.0'"),
};

console.log("Applied.");
console.log(`  deleted duplicate rows : ${deleted.toLocaleString()}`);
console.log(`  fund_portfolio now     : ${after.portfolioTotal.toLocaleString()} rows`);
console.log(
  `  remaining "….0" periods: ${after.dottyPortfolio + after.dottyAssetType} ` +
    `(portfolio ${after.dottyPortfolio}, asset_type ${after.dottyAssetType})`,
);

db.exec("VACUUM");
db.close();
