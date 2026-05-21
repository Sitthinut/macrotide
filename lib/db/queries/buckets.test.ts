import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { runWithDbContext } from "../context";
import * as schema from "../schema";
import { createBucket, deleteBucket, getBucket, listBuckets, updateBucket } from "./buckets";

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

const NEW_BUCKET = {
  id: "test-core",
  name: "Test Core",
  typeLabel: "Free",
  icon: "○",
  color: "#3b82f6",
  brokerage: "FNDQ",
  notes: null,
  goalText: null,
  targetModelId: null,
  targetAllocation: null,
};

function withFresh<T>(fn: () => T): T {
  const { sqlite, db } = freshDb();
  return runWithDbContext({ db, sqlite, isDemo: true, sessionId: "test" }, fn) as T;
}

describe("buckets queries", () => {
  it("creates and lists a bucket", () => {
    const created = withFresh(() => createBucket(NEW_BUCKET));
    expect(created.id).toBe("test-core");
    expect(created.name).toBe("Test Core");
  });

  it("getBucket returns the inserted row, undefined for missing ids", () => {
    withFresh(() => {
      createBucket(NEW_BUCKET);
      expect(getBucket("test-core")?.id).toBe("test-core");
      expect(getBucket("nope")).toBeUndefined();
    });
  });

  it("listBuckets is ordered by createdAt", () => {
    withFresh(() => {
      createBucket({ ...NEW_BUCKET, id: "a", name: "A" });
      createBucket({ ...NEW_BUCKET, id: "b", name: "B" });
      const rows = listBuckets();
      expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    });
  });

  it("updateBucket patches and bumps updatedAt", () => {
    withFresh(() => {
      const original = createBucket(NEW_BUCKET);
      // Ensure timestamps differ in millisecond precision.
      const updated = updateBucket("test-core", { name: "Renamed" });
      expect(updated?.name).toBe("Renamed");
      expect(updated?.updatedAt).not.toBe(original.updatedAt);
    });
  });

  it("deleteBucket removes the row", () => {
    withFresh(() => {
      createBucket(NEW_BUCKET);
      deleteBucket("test-core");
      expect(getBucket("test-core")).toBeUndefined();
    });
  });

  it("AsyncLocalStorage isolates DB contexts", () => {
    const { sqlite: sa, db: dba } = freshDb();
    const { sqlite: sb, db: dbb } = freshDb();

    runWithDbContext({ db: dba, sqlite: sa, isDemo: true, sessionId: "A" }, () => {
      createBucket(NEW_BUCKET);
    });

    // Bucket should not exist in the second DB.
    runWithDbContext({ db: dbb, sqlite: sb, isDemo: true, sessionId: "B" }, () => {
      expect(getBucket("test-core")).toBeUndefined();
      expect(listBuckets()).toHaveLength(0);
    });

    // ...but should in the first.
    runWithDbContext({ db: dba, sqlite: sa, isDemo: true, sessionId: "A" }, () => {
      expect(getBucket("test-core")).toBeDefined();
    });
  });
});
