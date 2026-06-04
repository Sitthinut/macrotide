// CLI entry point for the share-class refresh job.
//
// Usage:
//   npm run jobs:refresh-share-classes [-- [--limit=N]]
//
// --limit=N   Process at most N classes (for spike/dev runs). Default: all.
//
// Set DISABLE_JOBS=1 to make the script exit cleanly without doing anything.
// Loads .env.local via tsx's --env-file flag (configured in package.json).
//
// Cheap (no per-fund calls); safe to run after the catalog refresh on the same
// schedule. Idempotent — upserts keyed on (proj_id, class_name).

import { fileURLToPath } from "node:url";
import { refreshShareClasses } from "../lib/jobs/refresh-share-classes";

async function main() {
  if (process.env.DISABLE_JOBS === "1") {
    console.log("DISABLE_JOBS=1 — skipping share-class refresh.");
    return;
  }

  const limitArg = process.argv.slice(2).find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number.parseInt(limitArg.split("=")[1], 10) : 0;

  console.log(`Running share-class refresh (${limit > 0 ? `limit=${limit}` : "all classes"})…`);
  const r = await refreshShareClasses({ limit });
  console.log("\nDone.");
  console.log(`  Classes seen:      ${r.classesSeen}`);
  console.log(`  Classes upserted:  ${r.classesUpserted}`);
  console.log(`  Skipped (no parent in catalog): ${r.skippedNoParent}`);
  console.log(`  Skipped (no usable ticker):     ${r.skippedNoTicker}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((err) => {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
