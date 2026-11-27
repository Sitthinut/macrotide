// A broker sync's `source` names which connector the export came from, and it
// keys the per-user sync rows in `settings` and `broker_connections`. These tests
// pin that only a configured connector's source is accepted, and that a rejected
// sync writes nothing.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/with-db", () => ({
  withDb: <T>(fn: () => T | Promise<T>) => fn(),
}));
vi.mock("@/lib/api/broker-token-auth", () => ({
  withImportToken: async <T>(token: string, fn: () => T | Promise<T>) =>
    token === "good-token" ? { ok: true, value: await fn() } : { ok: false },
}));
const connectorState = vi.hoisted(() => ({ loaded: true }));
vi.mock("@/lib/portfolio/connector", () => ({
  getConnectors: async () =>
    connectorState.loaded
      ? [
          {
            id: "example",
            sourceTag: "example-broker",
            displayName: "Example Broker",
            host: "broker.example.test",
            planPath: "/plan",
            historyPath: "/history",
          },
        ]
      : [],
}));

import { POST } from "@/app/api/import/broker/ingest/route";
import { runWithDbContext } from "@/lib/db/context";
import { getBrokerAccountOrder, getBrokerLoginLabel } from "@/lib/db/queries/broker-connections";
import { makeTestDbContext } from "@/tests/db-helpers";

function brokerExport(source: unknown) {
  return {
    ...(source === undefined ? {} : { source }),
    exportedAt: "2026-06-07T00:00:00.000Z",
    accountLabel: "Example Login",
    accounts: [
      {
        account_code: "000000000001",
        name: "Growth",
        history: [
          {
            ref: "r1",
            order_type: "buy",
            fund_name: "EXAMPLE-FUND-A",
            status: "SUCCESS",
            trade_date: "2024-01-10",
            net_transaction_amount: 10000,
            net_transaction_unit: 500,
          },
        ],
      },
    ],
  };
}

function post(body: unknown, token?: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/import/broker/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-import-token": token } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

const TABLES = ["settings", "transactions", "buckets", "broker_connections"] as const;

/** A fresh DB context signed in as alice, with her user row in place. */
function aliceContext() {
  const ctx = makeTestDbContext({ userId: "alice" });
  ctx.appSqlite
    .prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('alice', 'Alice', 'alice@example.test', 0, 0, 0)",
    )
    .run();
  return ctx;
}

/** Run `fn` as alice in a fresh DB; returns per-table row counts before and after. */
async function asAlice(fn: () => Promise<Response>) {
  const ctx = aliceContext();
  const count = () =>
    Object.fromEntries(
      TABLES.map((t) => [
        t,
        (ctx.appSqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n,
      ]),
    );
  return runWithDbContext(ctx, async () => {
    const before = count();
    const res = await fn();
    return { res, before, after: count(), ctx };
  });
}

describe("broker sync source", () => {
  afterEach(() => {
    connectorState.loaded = true;
  });

  it("asks for a retry, and writes nothing, when no connector could be loaded", async () => {
    connectorState.loaded = false;
    const { res, before, after } = await asAlice(() => post(brokerExport("example-broker")));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("broker_unavailable");
    expect(after).toEqual(before);
  });

  it("accepts a configured connector's source and records its sync details", async () => {
    await runWithDbContext(aliceContext(), async () => {
      const res = await post(brokerExport("example-broker"));
      expect(res.status).toBe(201);
      expect((await res.json()).inserted).toBe(1);
      expect(getBrokerLoginLabel("example-broker")).toBe("Example Login");
      expect(getBrokerAccountOrder("example-broker")).toEqual(["000000000001"]);
    });
  });

  it("rejects an unknown source with a 400 and writes nothing", async () => {
    const { res, before, after } = await asAlice(() => post(brokerExport("made-up-broker")));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown_source");
    expect(after).toEqual(before);
  });

  it("rejects an unknown source on the import-token path too", async () => {
    const { res, before, after } = await asAlice(() =>
      post(brokerExport("made-up-broker"), "good-token"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown_source");
    expect(after).toEqual(before);
  });

  it("checks the token before the source, so an anonymous caller learns nothing", async () => {
    const { res, before, after } = await asAlice(() =>
      post(brokerExport("made-up-broker"), "wrong-token"),
    );
    expect(res.status).toBe(401);
    expect(after).toEqual(before);
  });

  it("can't grow settings rows by varying the source", async () => {
    const { before, after } = await asAlice(async () => {
      let last: Response | undefined;
      for (let i = 0; i < 5; i++) last = await post(brokerExport(`broker-${i}`));
      return last as Response;
    });
    expect(after.settings).toBe(before.settings);
  });

  it("trims the source before matching it", async () => {
    const { res } = await asAlice(() => post(brokerExport("  example-broker  ")));
    expect(res.status).toBe(201);
  });

  it("still accepts an export that names no source", async () => {
    const { res } = await asAlice(() => post(brokerExport(undefined)));
    expect(res.status).toBe(201);
  });
});
