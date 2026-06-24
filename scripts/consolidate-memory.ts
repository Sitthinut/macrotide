// CLI entrypoint for the memory consolidation sweep (#221 ⑨).
//
// Usage:
//   npm run jobs:consolidate-memory
//
// Pressure-gated + lexically pre-filtered, so it only spends model calls on
// scopes that are over the inject-all ceiling AND have plausible near-duplicates.
// Loads .env.local via tsx's --env-file flag (configured in package.json).

import { fileURLToPath } from "node:url";
import { consolidateMemory } from "../lib/jobs/consolidate-memory";

async function main() {
  if (process.env.DISABLE_JOBS === "1") {
    console.log("DISABLE_JOBS=1 — skipping memory consolidation sweep.");
    return;
  }
  console.log("Running memory consolidation sweep…");
  const result = await consolidateMemory();
  console.log("\nDone.");
  console.log(`  Scopes swept:        ${result.scopesSwept.length} (owner + registered users)`);
  console.log(`  With work:           ${result.scopesWorked}`);
  console.log(`  Merged (near-dups):  ${result.mergedCount}`);
  console.log(`  Reshaped (→ detail): ${result.reshapedCount}`);
  console.log(`  Recategorized:       ${result.recategorizedCount}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
