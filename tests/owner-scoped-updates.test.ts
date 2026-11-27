// Owner-scoped updates accept only their editable fields: a request body can
// carry any key, so these pin that `user_id`, the primary key and other
// server-managed columns never change through a PATCH, at both the query layer
// and the route handlers that feed it.

import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Route handlers run their body inside withDb; here the test already owns the
// DB context (fresh DB + user scope), so withDb just runs the callback.
vi.mock("@/lib/api/with-db", () => ({
  withDb: <T>(fn: () => T | Promise<T>) => fn(),
}));

import { PATCH as patchBucketRoute } from "@/app/api/buckets/[id]/route";
import { PATCH as patchJournalRoute } from "@/app/api/journal/[id]/route";
import { POST as postJournalRoute } from "@/app/api/journal/route";
import { PATCH as patchModelRoute } from "@/app/api/models/[id]/route";
import { getDb, runWithUserScope } from "@/lib/db/context";
import { createBucket, listBuckets, updateBucket } from "@/lib/db/queries/buckets";
import {
  createJournalEntry,
  listJournalEntries,
  updateJournalEntry,
} from "@/lib/db/queries/journal";
import {
  createModelPortfolio,
  listModelPortfolios,
  updateModelPortfolio,
} from "@/lib/db/queries/models";
import { pickEditable } from "@/lib/db/queries/scope";
import { buckets, journalEntries, modelPortfolios, user } from "@/lib/db/schema";
import { withFreshContext } from "@/tests/db-helpers";

function seedUsers(...ids: string[]): void {
  const now = new Date();
  for (const id of ids) {
    getDb()
      .insert(user)
      .values({
        id,
        name: id,
        email: `${id}@example.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

function jsonRequest(method: string, body: unknown): Request {
  return new Request("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const params = (id: string | number) => ({ params: Promise.resolve({ id: String(id) }) });

/** Read a row's owner directly, bypassing the per-user scope. */
function journalOwner(id: number): string | null | undefined {
  return getDb()
    .select({ userId: journalEntries.userId })
    .from(journalEntries)
    .where(eq(journalEntries.id, id))
    .get()?.userId;
}

describe("pickEditable", () => {
  it("keeps only listed, defined fields", () => {
    const patch = { title: "t", body: undefined, userId: "x", id: 9 } as Record<string, unknown>;
    expect(pickEditable(patch, ["title", "body"])).toEqual({ title: "t" });
  });

  it("keeps explicit nulls so a field can be cleared", () => {
    expect(pickEditable({ title: null, pinned: false }, ["title", "pinned"])).toEqual({
      title: null,
      pinned: false,
    });
  });
});

describe("journal updates keep their owner", () => {
  it("updateJournalEntry ignores userId, id and createdAt in the patch", async () => {
    await withFreshContext(async () => {
      seedUsers("alice", "bob");
      await runWithUserScope("alice", () => {
        const row = createJournalEntry({ kind: "note", body: "mine" });
        const patch = { title: "edited", userId: "bob", id: 999, createdAt: "2000-01-01" };
        // Cast: the type already rejects these keys; a request body can still carry them.
        const updated = updateJournalEntry(
          row.id,
          patch as Parameters<typeof updateJournalEntry>[1],
        );
        expect(updated?.title).toBe("edited");
        expect(updated?.id).toBe(row.id);
        expect(updated?.createdAt).toBe(row.createdAt);
        expect(journalOwner(row.id)).toBe("alice");
      });
      await runWithUserScope("bob", () => {
        expect(listJournalEntries()).toEqual([]);
      });
    });
  });

  it("an update with no editable fields is a no-op that still finds the entry", async () => {
    await withFreshContext(async () => {
      seedUsers("alice", "bob");
      await runWithUserScope("alice", () => {
        const row = createJournalEntry({ kind: "note", body: "mine" });
        const patch = { userId: "bob" } as Parameters<typeof updateJournalEntry>[1];
        expect(updateJournalEntry(row.id, patch)?.body).toBe("mine");
        expect(journalOwner(row.id)).toBe("alice");
      });
      await runWithUserScope("bob", () => {
        // Someone else's entry stays not-found, even for an empty patch.
        const [aliceRow] = getDb().select().from(journalEntries).all();
        expect(updateJournalEntry(aliceRow.id, {})).toBeUndefined();
      });
    });
  });

  it("PATCH /api/journal/[id] with userId in the body leaves the owner unchanged", async () => {
    await withFreshContext(async () => {
      seedUsers("alice", "bob");
      await runWithUserScope("alice", async () => {
        const row = createJournalEntry({ kind: "note", body: "mine" });
        const res = await patchJournalRoute(
          jsonRequest("PATCH", { userId: "bob", title: "edited" }),
          params(row.id),
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.title).toBe("edited");
        expect(body.userId).toBe("alice");
        expect(journalOwner(row.id)).toBe("alice");
      });
      await runWithUserScope("bob", () => {
        expect(listJournalEntries()).toEqual([]);
      });
    });
  });

  it("POST /api/journal ignores a client userId", async () => {
    await withFreshContext(async () => {
      seedUsers("alice", "bob");
      await runWithUserScope("alice", async () => {
        const res = await postJournalRoute(
          jsonRequest("POST", { kind: "note", body: "mine", userId: "bob", id: 777 }),
        );
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.userId).toBe("alice");
        expect(body.id).not.toBe(777);
      });
    });
  });
});

describe("journal kind validation", () => {
  it("PATCH rejects an unknown kind with 400 and leaves the entry unchanged", async () => {
    await withFreshContext(async () => {
      seedUsers("alice");
      await runWithUserScope("alice", async () => {
        const row = createJournalEntry({ kind: "note", body: "mine" });
        const res = await patchJournalRoute(
          jsonRequest("PATCH", { kind: "bogus" }),
          params(row.id),
        );
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("validation_failed");
        expect(body.issues[0].path).toEqual(["kind"]);
        expect(listJournalEntries()[0].kind).toBe("note");
      });
    });
  });

  it("PATCH accepts each valid kind", async () => {
    await withFreshContext(async () => {
      seedUsers("alice");
      await runWithUserScope("alice", async () => {
        const row = createJournalEntry({ kind: "note", body: "mine" });
        for (const kind of ["decision", "question", "reading", "note"]) {
          const res = await patchJournalRoute(jsonRequest("PATCH", { kind }), params(row.id));
          expect(res.status).toBe(200);
          expect((await res.json()).kind).toBe(kind);
        }
      });
    });
  });

  it("POST rejects an unknown or missing kind with 400 and creates nothing", async () => {
    await withFreshContext(async () => {
      seedUsers("alice");
      await runWithUserScope("alice", async () => {
        for (const payload of [{ kind: "bogus", body: "x" }, { body: "x" }]) {
          const res = await postJournalRoute(jsonRequest("POST", payload));
          expect(res.status).toBe(400);
          expect((await res.json()).error).toBe("validation_failed");
        }
        expect(listJournalEntries()).toEqual([]);
      });
    });
  });

  it("malformed JSON is a 400, not a server error", async () => {
    await withFreshContext(async () => {
      seedUsers("alice");
      await runWithUserScope("alice", async () => {
        const row = createJournalEntry({ kind: "note", body: "mine" });
        expect((await postJournalRoute(jsonRequest("POST", "{nope"))).status).toBe(400);
        expect(
          (await patchJournalRoute(jsonRequest("PATCH", "{nope"), params(row.id))).status,
        ).toBe(400);
      });
    });
  });
});

describe("bucket updates keep their owner and id", () => {
  const seedBucket = (id: string) =>
    createBucket({
      id,
      name: id,
      typeLabel: "Test",
      icon: "wallet",
      color: "#000",
      brokerage: "T",
    });

  it("updateBucket ignores userId and id in the patch", async () => {
    await withFreshContext(async () => {
      seedUsers("alice", "bob");
      await runWithUserScope("alice", () => {
        seedBucket("b-alice");
        const patch = { name: "Renamed", userId: "bob", id: "b-moved" };
        const updated = updateBucket("b-alice", patch as Parameters<typeof updateBucket>[1]);
        expect(updated?.name).toBe("Renamed");
        expect(updated?.id).toBe("b-alice");
        expect(updated?.userId).toBe("alice");
      });
      await runWithUserScope("bob", () => {
        expect(listBuckets()).toEqual([]);
      });
    });
  });

  it("PATCH /api/buckets/[id] with userId in the body leaves the owner unchanged", async () => {
    await withFreshContext(async () => {
      seedUsers("alice", "bob");
      await runWithUserScope("alice", async () => {
        seedBucket("b-alice");
        const res = await patchBucketRoute(
          jsonRequest("PATCH", { name: "Renamed", userId: "bob", id: "b-moved" }),
          { params: Promise.resolve({ id: "b-alice" }) },
        );
        expect(res.status).toBe(200);
        const row = getDb().select().from(buckets).where(eq(buckets.id, "b-alice")).get();
        expect(row?.name).toBe("Renamed");
        expect(row?.userId).toBe("alice");
      });
      await runWithUserScope("bob", () => {
        expect(listBuckets()).toEqual([]);
      });
    });
  });
});

describe("model portfolio updates keep their owner and stay private", () => {
  const seedModel = (id: string) =>
    createModelPortfolio({
      id,
      name: id,
      builtIn: false,
      allocation: [{ label: "Equity", pct: 100, color: "#000" }],
    });

  it("updateModelPortfolio ignores userId, id and builtIn in the patch", async () => {
    await withFreshContext(async () => {
      seedUsers("alice", "bob");
      await runWithUserScope("alice", () => {
        seedModel("m-alice");
        const patch = { name: "Renamed", userId: "bob", id: "m-moved", builtIn: true };
        const updated = updateModelPortfolio(
          "m-alice",
          patch as Parameters<typeof updateModelPortfolio>[1],
        );
        expect(updated?.name).toBe("Renamed");
        expect(updated?.id).toBe("m-alice");
        expect(updated?.userId).toBe("alice");
        expect(updated?.builtIn).toBe(false);
      });
      await runWithUserScope("bob", () => {
        expect(listModelPortfolios().map((m) => m.id)).not.toContain("m-alice");
      });
    });
  });

  it("PATCH /api/models/[id] cannot share a model or move it to another user", async () => {
    await withFreshContext(async () => {
      seedUsers("alice", "bob");
      await runWithUserScope("alice", async () => {
        seedModel("m-alice");
        const res = await patchModelRoute(
          jsonRequest("PATCH", { name: "Renamed", userId: "bob", builtIn: true }),
          { params: Promise.resolve({ id: "m-alice" }) },
        );
        expect(res.status).toBe(200);
        const row = getDb()
          .select()
          .from(modelPortfolios)
          .where(eq(modelPortfolios.id, "m-alice"))
          .get();
        expect(row?.name).toBe("Renamed");
        expect(row?.userId).toBe("alice");
        expect(row?.builtIn).toBe(false);
      });
      await runWithUserScope("bob", () => {
        expect(listModelPortfolios().map((m) => m.id)).not.toContain("m-alice");
      });
    });
  });

  it("an update with no editable fields returns the owner's row and never a built-in", async () => {
    await withFreshContext(async () => {
      seedUsers("alice");
      // A shared built-in (null-owned) that alice can read but not edit.
      createModelPortfolio({
        id: "m-builtin",
        name: "Built-in",
        builtIn: true,
        allocation: [{ label: "Equity", pct: 100, color: "#000" }],
      });
      await runWithUserScope("alice", () => {
        seedModel("m-alice");
        expect(updateModelPortfolio("m-alice", {})?.id).toBe("m-alice");
        expect(updateModelPortfolio("m-builtin", {})).toBeUndefined();
      });
    });
  });
});

describe("edge cases", () => {
  it("pickEditable treats a null or non-object patch as empty", () => {
    expect(pickEditable(null as unknown as object, [])).toEqual({});
    expect(pickEditable("title" as unknown as object, [])).toEqual({});
  });

  it("PATCH /api/buckets/[id] with a null body is refused, not a server error", async () => {
    await withFreshContext(async () => {
      seedUsers("alice");
      await runWithUserScope("alice", async () => {
        createBucket({ id: "b-alice", name: "Mine", brokerage: "T" });
        const res = await patchBucketRoute(jsonRequest("PATCH", "null"), {
          params: Promise.resolve({ id: "b-alice" }),
        });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe("validation_failed");
        expect(listBuckets()[0].name).toBe("Mine");
      });
    });
  });

  it("on the demo path (no signed-in user) a PATCH can't stamp an owner either", async () => {
    await withFreshContext(async () => {
      seedUsers("bob");
      const row = createJournalEntry({ kind: "note", body: "demo" });
      const res = await patchJournalRoute(
        jsonRequest("PATCH", { userId: "bob", pinned: true }),
        params(row.id),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).pinned).toBe(true);
      expect(journalOwner(row.id)).toBeNull();
    });
  });
});
