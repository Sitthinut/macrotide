// The portfolio create/edit routes accept only the editable fields, with length
// caps, and the server mints the id. These tests pin that a client can't set the
// id, owner or position, and the name limit (under, at and over).

import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/with-db", () => ({
  withDb: <T>(fn: () => T | Promise<T>) => fn(),
}));

import { PATCH } from "@/app/api/buckets/[id]/route";
import { POST } from "@/app/api/buckets/route";
import { getDb, runWithUserScope } from "@/lib/db/context";
import { createBucket } from "@/lib/db/queries/buckets";
import { buckets, user } from "@/lib/db/schema";
import { MAX_PORTFOLIO_NAME_LENGTH } from "@/lib/portfolio/bucket-input";
import { withFreshContext } from "@/tests/db-helpers";

function seedUser(id: string): void {
  const now = new Date();
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

function request(method: string, body: unknown): Request {
  return new Request("http://localhost/api/buckets", {
    method,
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const rows = () => getDb().select().from(buckets).all();

/** Run `fn` signed in as alice in a fresh DB. */
async function asAlice(fn: () => Promise<void>) {
  await withFreshContext(async () => {
    seedUser("alice");
    seedUser("bob");
    await runWithUserScope("alice", fn);
  });
}

describe("POST /api/buckets", () => {
  it("mints the id on the server and ignores owner, position and unknown keys", async () => {
    await asAlice(async () => {
      const res = await POST(
        request("POST", {
          id: "client-chosen",
          userId: "bob",
          position: -5,
          createdAt: "2000-01-01",
          name: "Retirement",
          icon: "wallet",
          color: "var(--accent)",
          notes: "",
          extra: "x".repeat(10_000),
        }),
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).not.toBe("client-chosen");
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
      const [row] = rows();
      expect(row).toMatchObject({
        name: "Retirement",
        userId: "alice",
        position: null,
        brokerage: "—",
      });
      expect(row.createdAt).not.toBe("2000-01-01");
    });
  });

  it("accepts a name under and at the limit", async () => {
    await asAlice(async () => {
      for (const n of [MAX_PORTFOLIO_NAME_LENGTH - 1, MAX_PORTFOLIO_NAME_LENGTH]) {
        expect((await POST(request("POST", { name: "n".repeat(n) }))).status).toBe(201);
      }
      expect(rows()).toHaveLength(2);
    });
  });

  it("refuses a name over the limit, an empty name and bad JSON, writing nothing", async () => {
    await asAlice(async () => {
      for (const body of [
        { name: "n".repeat(MAX_PORTFOLIO_NAME_LENGTH + 1) },
        { name: "  " },
        {},
        "{nope",
      ]) {
        const res = await POST(request("POST", body));
        expect(res.status).toBe(400);
      }
      expect(rows()).toHaveLength(0);
    });
  });

  it("refuses an oversized note or a malformed allocation", async () => {
    await asAlice(async () => {
      expect((await POST(request("POST", { name: "A", notes: "x".repeat(2001) }))).status).toBe(
        400,
      );
      expect(
        (await POST(request("POST", { name: "A", targetAllocation: { equity: "all" } }))).status,
      ).toBe(400);
      expect(rows()).toHaveLength(0);
    });
  });
});

describe("PATCH /api/buckets/[id]", () => {
  const params = { params: Promise.resolve({ id: "b-alice" }) };

  it("renames within the limit and keeps the brokerage when the body nulls it", async () => {
    await asAlice(async () => {
      createBucket({ id: "b-alice", name: "Mine", brokerage: "ACC-1" });
      const name = "n".repeat(MAX_PORTFOLIO_NAME_LENGTH);
      const res = await PATCH(request("PATCH", { name, brokerage: null }), params);
      expect(res.status).toBe(200);
      const row = getDb().select().from(buckets).where(eq(buckets.id, "b-alice")).get();
      expect(row).toMatchObject({ name, brokerage: "ACC-1" });
    });
  });

  it("keeps an existing over-long name editable when the name doesn't change", async () => {
    await asAlice(async () => {
      const long = "n".repeat(MAX_PORTFOLIO_NAME_LENGTH + 50);
      createBucket({ id: "b-alice", name: long, brokerage: "ACC-1" });
      const res = await PATCH(
        request("PATCH", { name: long, icon: "leaf", brokerage: "" }),
        params,
      );
      expect(res.status).toBe(200);
      expect(rows()[0]).toMatchObject({ name: long, icon: "leaf", brokerage: "ACC-1" });
    });
  });

  it("refuses a name over the limit and changes nothing", async () => {
    await asAlice(async () => {
      createBucket({ id: "b-alice", name: "Mine", brokerage: "ACC-1" });
      const res = await PATCH(
        request("PATCH", { name: "n".repeat(MAX_PORTFOLIO_NAME_LENGTH + 1) }),
        params,
      );
      expect(res.status).toBe(400);
      expect(rows()[0].name).toBe("Mine");
    });
  });
});
