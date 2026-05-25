// Per-user scoping invariant for the advisor holding-accept path. Holdings have
// no user_id of their own — they're scoped through their parent bucket. These
// lock in that applyHoldingProposal can ONLY attach a holding to a bucket the
// CALLER owns:
//   - a bucketId belonging to another user is rejected (bucket_not_found);
//   - omitting bucketId falls back to the caller's OWN first bucket, never
//     another user's;
//   - with no buckets at all it fails cleanly (no_bucket) instead of throwing.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { type DbContext, runWithDbContext } from "../db/context";
import { createBucket } from "../db/queries/buckets";
import { getHolding, listHoldings } from "../db/queries/holdings";
import * as schema from "../db/schema";
import { user } from "../db/schema";
import { applyHoldingProposal } from "./apply-holding-proposal";

function freshDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const migrationsDir = resolve("lib/db/migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const sql = files
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    .join("\n")
    .replace(/--> statement-breakpoint/g, ";");
  sqlite.exec(sql);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

function seedUsers(db: ReturnType<typeof freshDb>["db"]) {
  const now = new Date();
  db.insert(user)
    .values([
      {
        id: "u1",
        name: "U1",
        email: "u1@x.io",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "u2",
        name: "U2",
        email: "u2@x.io",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
}

const BUCKET = {
  name: "B",
  typeLabel: null,
  icon: null,
  color: null,
  brokerage: "FNDQ",
  notes: null,
  goalText: null,
  targetModelId: null,
  targetAllocation: null,
};

const HOLDING = {
  ticker: "voo",
  englishName: "Vanguard S&P 500",
  units: 10,
  avgCost: 400,
};

describe("applyHoldingProposal — per-user scoping", () => {
  it("writes the holding to the caller's own bucket (single-owner / null context)", () => {
    const { sqlite, db } = freshDb();
    const ctx: DbContext = { db, sqlite, isDemo: false, sessionId: "s", userId: null };
    runWithDbContext(ctx, () => {
      createBucket({ ...BUCKET, id: "b" });
      const result = applyHoldingProposal({ bucketId: "b", ...HOLDING });
      expect(result.ok).toBe(true);
      expect(result.holding?.bucketId).toBe("b");
      // Ticker normalized to upper-case on write.
      expect(result.holding?.ticker).toBe("VOO");
      expect(listHoldings()).toHaveLength(1);
    });
  });

  it("REJECTS a bucketId owned by another user (bucket_not_found)", () => {
    const { sqlite, db } = freshDb();
    seedUsers(db);
    const asU1: DbContext = { db, sqlite, isDemo: false, sessionId: "s", userId: "u1" };
    const asU2: DbContext = { db, sqlite, isDemo: false, sessionId: "s", userId: "u2" };

    // u1 owns bucket b1.
    runWithDbContext(asU1, () => createBucket({ ...BUCKET, id: "b1", name: "B1" }));

    // u2 tries to write a holding into u1's bucket — must be refused, and
    // nothing may be written.
    runWithDbContext(asU2, () => {
      const result = applyHoldingProposal({ bucketId: "b1", ...HOLDING });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("bucket_not_found");
    });
    // The row must not exist (global read confirms no leak-write happened).
    runWithDbContext(asU1, () => {
      expect(listHoldings("b1")).toHaveLength(0);
    });
  });

  it("falls back to the CALLER's own first bucket, never another user's", () => {
    const { sqlite, db } = freshDb();
    seedUsers(db);
    const asU1: DbContext = { db, sqlite, isDemo: false, sessionId: "s", userId: "u1" };
    const asU2: DbContext = { db, sqlite, isDemo: false, sessionId: "s", userId: "u2" };

    runWithDbContext(asU1, () => createBucket({ ...BUCKET, id: "b1", name: "B1" }));
    runWithDbContext(asU2, () => createBucket({ ...BUCKET, id: "b2", name: "B2" }));

    // u2 omits bucketId → must land in b2 (their own), not b1.
    const result = runWithDbContext(asU2, () =>
      applyHoldingProposal({ bucketId: null, ...HOLDING }),
    ) as ReturnType<typeof applyHoldingProposal>;
    expect(result.ok).toBe(true);
    expect(result.holding?.bucketId).toBe("b2");

    // Confirm the written row really is in b2.
    runWithDbContext(asU2, () => {
      const id = result.holding?.id as number;
      expect(getHolding(id)?.bucketId).toBe("b2");
    });
  });

  it("fails cleanly with no_bucket when the caller has no buckets", () => {
    const { sqlite, db } = freshDb();
    seedUsers(db);
    const asU1: DbContext = { db, sqlite, isDemo: false, sessionId: "s", userId: "u1" };
    runWithDbContext(asU1, () => {
      const result = applyHoldingProposal({ bucketId: null, ...HOLDING });
      expect(result.ok).toBe(false);
      expect(result.error).toBe("no_bucket");
    });
  });

  it("rejects invalid payloads (no ticker / non-positive units)", () => {
    const { sqlite, db } = freshDb();
    const ctx: DbContext = { db, sqlite, isDemo: false, sessionId: "s", userId: null };
    runWithDbContext(ctx, () => {
      createBucket({ ...BUCKET, id: "b" });
      expect(
        applyHoldingProposal({ bucketId: "b", ticker: "", englishName: "x", units: 1 }).error,
      ).toBe("invalid");
      expect(
        applyHoldingProposal({ bucketId: "b", ticker: "VOO", englishName: "x", units: 0 }).error,
      ).toBe("invalid");
    });
  });
});
