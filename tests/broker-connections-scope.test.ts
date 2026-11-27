// A broker account code is only unique within its broker. These tests pin that
// sync, remap, purge and the held count act on one broker's account even when
// another broker uses the same code, that a refused remap creates nothing, and
// that a sync with nothing to route saves nothing.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/with-db", () => ({
  withDb: <T>(fn: () => T | Promise<T>) => fn(),
}));
vi.mock("@/lib/api/broker-token-auth", () => ({
  withImportToken: async () => ({ ok: false }),
}));
vi.mock("@/lib/portfolio/connector", () => ({
  getConnectors: async () =>
    ["broker-a", "broker-b"].map((tag) => ({
      id: tag,
      sourceTag: tag,
      displayName: tag,
      host: `${tag}.example.test`,
      planPath: "/plan",
      historyPath: "/history",
    })),
}));

import {
  DELETE as deleteConnections,
  GET as listConnections,
  PATCH as patchConnection,
} from "@/app/api/import/broker/connections/route";
import { POST as ingest } from "@/app/api/import/broker/ingest/route";
import { runWithDbContext } from "@/lib/db/context";
import { makeTestDbContext } from "@/tests/db-helpers";

const CODE = "000000000001";

function brokerExport(source: string, ticker: string) {
  return {
    source,
    accountLabel: `${source} login`,
    accounts: [
      {
        account_code: CODE,
        name: `${source} plan`,
        history: [
          {
            ref: "r1",
            order_type: "buy",
            fund_name: ticker,
            status: "SUCCESS",
            trade_date: "2024-01-10",
            net_transaction_amount: 1000,
            net_transaction_unit: 50,
          },
        ],
      },
    ],
  };
}

function json(method: string, body: unknown): Request {
  return new Request("http://localhost/api/import/broker/x", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function aliceContext() {
  const ctx = makeTestDbContext({ userId: "alice" });
  ctx.appSqlite
    .prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('alice', 'Alice', 'alice@example.test', 0, 0, 0)",
    )
    .run();
  return ctx;
}

type Ctx = ReturnType<typeof aliceContext>;

const all = (ctx: Ctx, sql: string) =>
  ctx.appSqlite.prepare(sql).all() as Record<string, unknown>[];
const count = (ctx: Ctx, table: string) =>
  (ctx.appSqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

/** Alice syncs the same account code from both brokers. */
async function syncBoth() {
  expect((await ingest(json("POST", brokerExport("broker-a", "EXAMPLE-FUND-A")))).status).toBe(201);
  expect((await ingest(json("POST", brokerExport("broker-b", "EXAMPLE-FUND-B")))).status).toBe(201);
}

/** Bucket id per broker, from its connection. */
function bucketOf(ctx: Ctx, source: string): string {
  return all(ctx, `SELECT bucket_id FROM broker_connections WHERE source = '${source}'`)[0]
    .bucket_id as string;
}

describe("same account code under two brokers", () => {
  it("keeps each broker's orders in its own portfolio on sync", async () => {
    const ctx = aliceContext();
    await runWithDbContext(ctx, async () => {
      await syncBoth();
      const rows = all(ctx, "SELECT ticker, bucket_id FROM transactions ORDER BY ticker");
      expect(rows).toEqual([
        { ticker: "EXAMPLE-FUND-A", bucket_id: bucketOf(ctx, "broker-a") },
        { ticker: "EXAMPLE-FUND-B", bucket_id: bucketOf(ctx, "broker-b") },
      ]);
      expect(bucketOf(ctx, "broker-a")).not.toBe(bucketOf(ctx, "broker-b"));
    });
  });

  it("remaps only the named broker's orders", async () => {
    const ctx = aliceContext();
    await runWithDbContext(ctx, async () => {
      await syncBoth();
      const a = bucketOf(ctx, "broker-a");
      const res = await patchConnection(
        json("PATCH", { source: "broker-b", accountCode: CODE, newName: "Moved" }),
      );
      expect(res.status).toBe(200);
      const { bucketId, moved } = await res.json();
      expect(moved).toBe(1);
      expect(all(ctx, "SELECT ticker, bucket_id FROM transactions ORDER BY ticker")).toEqual([
        { ticker: "EXAMPLE-FUND-A", bucket_id: a },
        { ticker: "EXAMPLE-FUND-B", bucket_id: bucketId },
      ]);
    });
  });

  it("purges only the named broker's orders and counts holdings per broker", async () => {
    const ctx = aliceContext();
    await runWithDbContext(ctx, async () => {
      await syncBoth();
      const listed = await (await listConnections()).json();
      expect(listed.map((c: { holdings: number }) => c.holdings)).toEqual([1, 1]);

      const res = await deleteConnections(
        json("DELETE", { all: true, source: "broker-b", mode: "purge" }),
      );
      expect((await res.json()).removed).toBe(1);
      expect(all(ctx, "SELECT ticker FROM transactions")).toEqual([{ ticker: "EXAMPLE-FUND-A" }]);
    });
  });
});

describe("refused writes", () => {
  it("creates no portfolio when remapping an account that isn't linked", async () => {
    const ctx = aliceContext();
    await runWithDbContext(ctx, async () => {
      const before = count(ctx, "buckets");
      const res = await patchConnection(
        json("PATCH", { source: "broker-a", accountCode: "unknown", newName: "Stray" }),
      );
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("connection_not_found");
      expect(count(ctx, "buckets")).toBe(before);
    });
  });

  it("saves nothing when a sync has no portfolio to route to", async () => {
    const ctx = aliceContext();
    await runWithDbContext(ctx, async () => {
      const before = ["settings", "transactions", "buckets"].map((t) => count(ctx, t));
      // An export without an account list routes to an existing portfolio, and
      // alice has none.
      const { accounts, ...rest } = brokerExport("broker-a", "EXAMPLE-FUND-A");
      const res = await ingest(json("POST", { ...rest, history: accounts[0].history }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("no_bucket");
      expect(["settings", "transactions", "buckets"].map((t) => count(ctx, t))).toEqual(before);
    });
  });
});
