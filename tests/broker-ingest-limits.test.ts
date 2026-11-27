// A broker sync creates a portfolio and a connection per new account and stores
// the login label and account order per user. These tests pin the size limits on
// each of those (at, under and over), and that a refused or failed sync writes
// nothing at all.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/with-db", () => ({
  withDb: <T>(fn: () => T | Promise<T>) => fn(),
}));
vi.mock("@/lib/api/broker-token-auth", () => ({
  withImportToken: async <T>(token: string, fn: () => T | Promise<T>) =>
    token === "good-token" ? { ok: true, value: await fn() } : { ok: false },
}));
vi.mock("@/lib/portfolio/connector", () => ({
  getConnectors: async () => [
    {
      id: "example",
      sourceTag: "example-broker",
      displayName: "Example Broker",
      host: "broker.example.test",
      planPath: "/plan",
      historyPath: "/history",
    },
  ],
}));

import { POST } from "@/app/api/import/broker/ingest/route";
import { runWithDbContext } from "@/lib/db/context";
import { getBrokerAccountOrder, getBrokerLoginLabel } from "@/lib/db/queries/broker-connections";
import {
  MAX_ACCOUNT_CODE_LENGTH,
  MAX_ACCOUNT_NAME_LENGTH,
  MAX_LOGIN_LABEL_LENGTH,
  MAX_SYNC_ACCOUNTS,
  MAX_SYNC_BODY_BYTES,
  MAX_TICKER_LENGTH,
  MAX_USER_BROKER_CONNECTIONS,
} from "@/lib/portfolio/broker-sync-limits";
import { makeTestDbContext } from "@/tests/db-helpers";

interface AccountSpec {
  code: unknown;
  name?: string;
  ticker?: string;
  ref?: string;
  withHistory?: boolean;
}

function account(spec: AccountSpec, i: number) {
  return {
    account_code: spec.code,
    name: spec.name ?? `Plan ${i}`,
    history:
      spec.withHistory === false
        ? []
        : [
            {
              ref: spec.ref ?? `r${i}`,
              order_type: "buy",
              fund_name: spec.ticker ?? "EXAMPLE-FUND-A",
              status: "SUCCESS",
              trade_date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
              net_transaction_amount: 1000,
              net_transaction_unit: 50,
            },
          ],
  };
}

function brokerExport(accounts: AccountSpec[], accountLabel = "Example Login") {
  return {
    source: "example-broker",
    exportedAt: "2026-06-07T00:00:00.000Z",
    accountLabel,
    accounts: accounts.map(account),
  };
}

/** `n` accounts with distinct codes, all with one order each. */
function accounts(n: number, prefix = "acct-"): AccountSpec[] {
  return Array.from({ length: n }, (_, i) => ({ code: `${prefix}${i}` }));
}

function post(body: unknown, init: { token?: string; raw?: string } = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/import/broker/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(init.token ? { "x-import-token": init.token } : {}),
      },
      body: init.raw ?? JSON.stringify(body),
    }),
  );
}

const TABLES = ["settings", "transactions", "buckets", "broker_connections"] as const;

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

/** Give alice `n` existing connections (and their portfolios) under `source`. */
function seedConnections(ctx: Ctx, n: number, source = "example-broker", prefix = "old-") {
  const bucket = ctx.appSqlite.prepare(
    "INSERT INTO buckets (id, user_id, name, brokerage) VALUES (?, 'alice', ?, 'seed')",
  );
  const conn = ctx.appSqlite.prepare(
    "INSERT INTO broker_connections (user_id, source, account_code, bucket_id) VALUES ('alice', ?, ?, ?)",
  );
  for (let i = 0; i < n; i++) {
    bucket.run(`b-${prefix}${i}`, `Seed ${i}`);
    conn.run(source, `${prefix}${i}`, `b-${prefix}${i}`);
  }
}

/** Run `fn` as alice; returns per-table row counts before and after. */
async function asAlice(fn: () => Promise<Response>, setup?: (ctx: Ctx) => void) {
  const ctx = aliceContext();
  setup?.(ctx);
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

async function expectRefused(
  r: Awaited<ReturnType<typeof asAlice>>,
  error: string,
  status = 400,
): Promise<void> {
  expect(r.res.status).toBe(status);
  const body = await r.res.json();
  expect(body.error).toBe(error);
  expect(typeof body.message).toBe("string");
  expect(r.after).toEqual(r.before);
}

describe("accounts per sync", () => {
  it("accepts an export just under the limit", async () => {
    const r = await asAlice(() => post(brokerExport(accounts(MAX_SYNC_ACCOUNTS - 1))));
    expect(r.res.status).toBe(201);
    expect(r.after.broker_connections).toBe(MAX_SYNC_ACCOUNTS - 1);
  });

  it("accepts an export at the limit", async () => {
    const r = await asAlice(() => post(brokerExport(accounts(MAX_SYNC_ACCOUNTS))));
    expect(r.res.status).toBe(201);
    expect(r.after.broker_connections).toBe(MAX_SYNC_ACCOUNTS);
    expect(r.after.buckets).toBe(MAX_SYNC_ACCOUNTS);
  });

  it("refuses an export over the limit and writes nothing", async () => {
    const r = await asAlice(() => post(brokerExport(accounts(MAX_SYNC_ACCOUNTS + 1))));
    await expectRefused(r, "too_many_accounts");
  });

  it("refuses on the import-token path too", async () => {
    const r = await asAlice(() =>
      post(brokerExport(accounts(MAX_SYNC_ACCOUNTS + 1)), { token: "good-token" }),
    );
    await expectRefused(r, "too_many_accounts");
  });

  it("counts listed accounts with no orders, which only feed the stored account order", async () => {
    const listed = accounts(MAX_SYNC_ACCOUNTS + 1).map((a, i) => ({
      ...a,
      withHistory: i === 0,
    }));
    const r = await asAlice(() => post(brokerExport(listed)));
    await expectRefused(r, "too_many_accounts");
  });

  it("stores the account order for an export at the limit", async () => {
    const listed = accounts(MAX_SYNC_ACCOUNTS);
    await runWithDbContext(aliceContext(), async () => {
      expect((await post(brokerExport(listed))).status).toBe(201);
      expect(getBrokerAccountOrder("example-broker")).toEqual(listed.map((a) => a.code));
    });
  });

  it("counts a repeated account code once", async () => {
    const listed = [...accounts(MAX_SYNC_ACCOUNTS), { code: "acct-0", ref: "r-again" }];
    const r = await asAlice(() => post(brokerExport(listed)));
    expect(r.res.status).toBe(201);
    expect(r.after.broker_connections).toBe(MAX_SYNC_ACCOUNTS);
  });
});

describe("connections per user", () => {
  const room = 2;
  const seed = (ctx: Ctx) => seedConnections(ctx, MAX_USER_BROKER_CONNECTIONS - room);

  it("accepts new accounts that stay under the limit", async () => {
    const r = await asAlice(() => post(brokerExport(accounts(room - 1))), seed);
    expect(r.res.status).toBe(201);
    expect(r.after.broker_connections).toBe(MAX_USER_BROKER_CONNECTIONS - 1);
  });

  it("accepts new accounts that reach the limit exactly", async () => {
    const r = await asAlice(() => post(brokerExport(accounts(room))), seed);
    expect(r.res.status).toBe(201);
    expect(r.after.broker_connections).toBe(MAX_USER_BROKER_CONNECTIONS);
  });

  it("refuses new accounts past the limit and writes nothing", async () => {
    const r = await asAlice(() => post(brokerExport(accounts(room + 1))), seed);
    await expectRefused(r, "account_limit");
  });

  it("counts connections under every broker", async () => {
    const r = await asAlice(
      () => post(brokerExport(accounts(room + 1))),
      (ctx) => seedConnections(ctx, MAX_USER_BROKER_CONNECTIONS - room, "other-broker"),
    );
    await expectRefused(r, "account_limit");
  });

  it("keeps syncing linked accounts for a user already over the limit", async () => {
    const r = await asAlice(
      () => post(brokerExport([{ code: "old-0" }, { code: "old-1" }])),
      (ctx) => seedConnections(ctx, MAX_USER_BROKER_CONNECTIONS + 5),
    );
    expect(r.res.status).toBe(201);
    expect(r.after.broker_connections).toBe(r.before.broker_connections);
    expect(r.after.transactions).toBe(2);
  });

  it("refuses a new account for a user already over the limit", async () => {
    const r = await asAlice(
      () => post(brokerExport([{ code: "old-0" }, { code: "brand-new" }])),
      (ctx) => seedConnections(ctx, MAX_USER_BROKER_CONNECTIONS + 5),
    );
    await expectRefused(r, "account_limit");
  });

  it("doesn't count another user's connections", async () => {
    const r = await asAlice(
      () => post(brokerExport(accounts(room + 1))),
      (ctx) => {
        ctx.appSqlite
          .prepare(
            "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('bob', 'Bob', 'bob@example.test', 0, 0, 0)",
          )
          .run();
        const conn = ctx.appSqlite.prepare(
          "INSERT INTO broker_connections (user_id, source, account_code) VALUES ('bob', 'example-broker', ?)",
        );
        for (let i = 0; i < MAX_USER_BROKER_CONNECTIONS; i++) conn.run(`bob-${i}`);
      },
    );
    expect(r.res.status).toBe(201);
  });
});

describe("login label", () => {
  it("stores a label under the limit", async () => {
    await runWithDbContext(aliceContext(), async () => {
      const label = "x".repeat(MAX_LOGIN_LABEL_LENGTH - 1);
      expect((await post(brokerExport(accounts(1), label))).status).toBe(201);
      expect(getBrokerLoginLabel("example-broker")).toBe(label);
    });
  });

  it("stores a label at the limit", async () => {
    await runWithDbContext(aliceContext(), async () => {
      const label = "x".repeat(MAX_LOGIN_LABEL_LENGTH);
      expect((await post(brokerExport(accounts(1), label))).status).toBe(201);
      expect(getBrokerLoginLabel("example-broker")).toBe(label);
    });
  });

  it("refuses a label over the limit and writes nothing", async () => {
    const label = "x".repeat(MAX_LOGIN_LABEL_LENGTH + 1);
    const r = await asAlice(() => post(brokerExport(accounts(1), label)));
    await expectRefused(r, "label_too_long");
  });
});

describe("field lengths", () => {
  const cases: [string, number, (len: number) => AccountSpec][] = [
    ["an account code", MAX_ACCOUNT_CODE_LENGTH, (n) => ({ code: "c".repeat(n) })],
    ["an account name", MAX_ACCOUNT_NAME_LENGTH, (n) => ({ code: "acct-0", name: "n".repeat(n) })],
    ["a fund code", MAX_TICKER_LENGTH, (n) => ({ code: "acct-0", ticker: "T".repeat(n) })],
  ];

  for (const [label, max, spec] of cases) {
    it(`accepts ${label} under and at the limit`, async () => {
      for (const n of [max - 1, max]) {
        const r = await asAlice(() => post(brokerExport([spec(n)])));
        expect(r.res.status).toBe(201);
      }
    });

    it(`refuses ${label} over the limit and writes nothing`, async () => {
      const r = await asAlice(() => post(brokerExport([spec(max + 1)])));
      await expectRefused(r, "field_too_long");
    });
  }

  it("refuses an order reference that makes the dedup key too long", async () => {
    const r = await asAlice(() => post(brokerExport([{ code: "acct-0", ref: "r".repeat(600) }])));
    await expectRefused(r, "field_too_long");
  });

  it("accepts a numeric account code and stores its digits", async () => {
    const r = await asAlice(() => post(brokerExport([{ code: 1234 }])));
    expect(r.res.status).toBe(201);
    const row = r.ctx.appSqlite
      .prepare("SELECT account_code AS code FROM broker_connections")
      .get() as { code: string };
    expect(row.code).toBe("1234");
  });

  it("refuses an account code that isn't text or a number", async () => {
    const r = await asAlice(() => post(brokerExport([{ code: { nested: "x".repeat(100) } }])));
    await expectRefused(r, "bad_request");
  });
});

describe("body size", () => {
  it("refuses a body declared over the limit before reading it", async () => {
    const r = await asAlice(() =>
      POST(
        new Request("http://localhost/api/import/broker/ingest", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(MAX_SYNC_BODY_BYTES + 1),
          },
          body: JSON.stringify(brokerExport(accounts(1))),
        }),
      ),
    );
    await expectRefused(r, "payload_too_large", 413);
  });

  it("refuses a body that turns out over the limit", async () => {
    const big = JSON.stringify({
      ...brokerExport(accounts(1)),
      padding: "x".repeat(MAX_SYNC_BODY_BYTES),
    });
    const r = await asAlice(() => post(undefined, { raw: big }));
    await expectRefused(r, "payload_too_large", 413);
  });
});

describe("atomic writes", () => {
  it("rolls back every account when a later write fails", async () => {
    const ctx = aliceContext();
    // Make the second account's insert fail at the database, after the first
    // account's portfolio, connection and orders were written.
    ctx.appSqlite.exec(
      "CREATE TRIGGER fail_insert BEFORE INSERT ON transactions WHEN NEW.ticker = 'EXAMPLE-FUND-FAIL' BEGIN SELECT RAISE(ABORT, 'forced failure'); END;",
    );
    const count = (t: string) =>
      (ctx.appSqlite.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
    await runWithDbContext(ctx, async () => {
      const before = TABLES.map(count);
      await expect(
        post(brokerExport([{ code: "acct-0" }, { code: "acct-1", ticker: "EXAMPLE-FUND-FAIL" }])),
      ).rejects.toThrow(/forced failure/);
      expect(TABLES.map(count)).toEqual(before);
    });
  });
});
