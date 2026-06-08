import { describe, expect, it } from "vitest";
import {
  type BrokerExport,
  buildUserscript,
  COLLECTOR_PROTOCOL_VERSION,
  type ConnectorShape,
  looksLikeBrokerExport,
  parseBrokerExport,
  resolveCollectorShape,
} from "./index";

// Synthetic fixture mirroring the SDK's DEFAULT wire shape (no real account
// data): one multi-account export covering every order_type + status we handle.
// Parsing it with NO shape exercises the built-in defaults.
const EXPORT: BrokerExport = {
  source: "broker",
  exportedAt: "2026-06-07T00:00:00.000Z",
  accounts: [
    {
      account_code: "000000000001",
      name: "Growth",
      type: "guruport",
      history: [
        {
          ref: "r1",
          order_type: "buy",
          fund_name: "AAA-EQ",
          status: "SUCCESS",
          trade_date: "2024-01-10",
          net_transaction_amount: 10000,
          net_transaction_unit: 500,
          unit_type: "baht",
        } as never,
        {
          ref: "r2",
          order_type: "sell",
          fund_name: "AAA-EQ",
          status: "SUCCESS",
          trade_date: "2024-03-15",
          net_transaction_amount: 6000,
          net_transaction_unit: 250,
        },
        {
          // A switch → expands to a sell of BBB-BOND + a buy of CCC-GOLD.
          ref: "r3",
          order_type: "switch",
          fund_name: "BBB-BOND",
          status: "SUCCESS",
          trade_date: "2024-02-20",
          net_transaction_amount: 8000,
          unit: 800,
          net_transaction_unit: 800,
          sw_to_fund: "CCC-GOLD",
          sw_in_net_transaction_amount: 8000,
          sw_in_net_transaction_unit: 400,
        },
        {
          ref: "r4",
          order_type: "dividend",
          fund_name: "AAA-EQ",
          status: "SUCCESS",
          trade_date: "2024-04-01",
          amount: 123.45,
          unit: 500, // units held — must NOT become a unit delta
        },
        {
          // Cancelled — dropped.
          order_type: "sell",
          fund_name: "AAA-EQ",
          status: "CANCEL",
          trade_date: "2024-05-01",
          net_transaction_amount: 999,
          net_transaction_unit: 40,
        },
        {
          // Unknown type — counted, not imported.
          order_type: "fee_rebate",
          fund_name: "AAA-EQ",
          status: "SUCCESS",
          trade_date: "2024-06-01",
          net_transaction_amount: 5,
        } as never,
      ],
      pending: [
        { order_type: "sell", fund_name: "AAA-EQ", status: "PENDING", trade_date: "2026-06-05" },
      ],
    },
    {
      account_code: "000000000002",
      name: "Tax",
      type: "tax-saving-fund",
      history: [
        {
          ref: "r7",
          order_type: "buy",
          fund_name: "DDD-IDX",
          status: "SUCCESS",
          trade_date: "2023-12-01",
          net_transaction_amount: 50000,
          net_transaction_unit: 1000,
        },
      ],
    },
  ],
};

describe("parseBrokerExport (default shape)", () => {
  const res = parseBrokerExport(EXPORT);

  it("imports buy/sell/dividend and expands switch into two rows", () => {
    // 2 plain (buy, sell) + 2 from switch + 1 dividend + 1 other-account buy = 6
    expect(res.stats.imported).toBe(6);
    expect(res.rows).toHaveLength(6);
    expect(res.stats.accounts).toBe(2);
    expect(res.stats.switches).toBe(1);
    expect(res.stats.dividends).toBe(1);
  });

  it("drops cancelled and pending, counts unknown", () => {
    expect(res.stats.skippedCancel).toBe(1);
    expect(res.stats.skippedUnknown).toBe(1); // fee_rebate
    // PENDING lives only in `pending` (not imported) — never counted as history.
    expect(res.rows.find((r) => r.amount === 999)).toBeUndefined();
  });

  it("maps a switch to sell(out) + buy(in) on the same date", () => {
    const sell = res.rows.find((r) => r.ticker === "BBB-BOND");
    const buy = res.rows.find((r) => r.ticker === "CCC-GOLD");
    expect(sell).toMatchObject({ kind: "sell", units: 800, amount: 8000, tradeDate: "2024-02-20" });
    expect(buy).toMatchObject({ kind: "buy", units: 400, amount: 8000, tradeDate: "2024-02-20" });
  });

  it("records a dividend as cash with no unit delta", () => {
    const div = res.rows.find((r) => r.kind === "dividend");
    expect(div).toMatchObject({ ticker: "AAA-EQ", amount: 123.45 });
    expect(div?.units).toBeUndefined();
  });

  it("returns rows oldest-first", () => {
    const dates = res.rows.map((r) => r.tradeDate);
    expect(dates).toEqual([...dates].sort((a, b) => (a ?? "").localeCompare(b ?? "")));
  });

  it("accepts a single-portfolio {history} shape", () => {
    const r = parseBrokerExport({ history: EXPORT.accounts?.[1].history });
    expect(r.stats.imported).toBe(1);
    expect(r.rows[0]).toMatchObject({ ticker: "DDD-IDX", kind: "buy" });
  });

  it("accepts a raw API page {data}", () => {
    const r = parseBrokerExport({
      status: true,
      data: EXPORT.accounts?.[1].history,
      pagination: {},
    });
    expect(r.stats.imported).toBe(1);
  });

  it("accepts a bare order array", () => {
    const r = parseBrokerExport(EXPORT.accounts?.[1].history);
    expect(r.stats.imported).toBe(1);
  });

  it("parses a JSON string too", () => {
    const r = parseBrokerExport(JSON.stringify(EXPORT));
    expect(r.stats.imported).toBe(6);
  });

  it("returns a friendly warning on garbage", () => {
    const r = parseBrokerExport("not json");
    expect(r.rows).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/broker data/i);
  });

  it("stamps a stable externalId + externalAccount from sourceTag:account:ref", () => {
    const buy = res.rows.find((r) => r.ticker === "AAA-EQ" && r.kind === "buy");
    expect(buy?.externalId).toBe("broker:000000000001:r1");
    expect(buy?.externalAccount).toBe("000000000001");
    // A second account's row carries that account_code.
    const other = res.rows.find((r) => r.ticker === "DDD-IDX");
    expect(other?.externalId).toBe("broker:000000000002:r7");
    expect(other?.externalAccount).toBe("000000000002");
  });

  it("gives a switch's two legs distinct :out / :in ids on the same ref", () => {
    const sell = res.rows.find((r) => r.ticker === "BBB-BOND");
    const buy = res.rows.find((r) => r.ticker === "CCC-GOLD");
    expect(sell?.externalId).toBe("broker:000000000001:r3:out");
    expect(buy?.externalId).toBe("broker:000000000001:r3:in");
  });

  it("falls back to a content id + warns when an order has no ref", () => {
    const r = parseBrokerExport([
      {
        order_type: "buy",
        fund_name: "NOREF-FUND",
        status: "SUCCESS",
        trade_date: "2024-07-01",
        net_transaction_amount: 1000,
        net_transaction_unit: 10,
      },
    ]);
    expect(r.rows[0].externalId).toMatch(/^broker::c:/);
    expect(r.warnings.some((w) => /no stable id/i.test(w))).toBe(true);
  });
});

// ── Genericity: a synthetic broker with COMPLETELY different field names. ──────
// Nothing here matches the built-in defaults; parsing/emitting it correctly is
// what proves the SDK is shape-driven (a new broker = a manifest, not new code).
const ALT_SHAPE: ConnectorShape = {
  order: {
    type: "txnKind",
    ticker: "symbol",
    status: "state",
    tradeDate: "dealDate",
    amount: "cashValue",
    units: "shares",
    dividendAmount: "cashValue",
    ref: "dealId",
    switch: { toTicker: "intoSymbol", inAmount: "intoCash", inUnits: "intoShares" },
  },
  values: {
    success: ["DONE"],
    cancel: ["VOID"],
    pending: ["WAITING"],
    buy: ["BOT"],
    sell: ["SLD"],
    switch: ["SWAP"],
    dividend: ["DIV"],
  },
  plan: {
    accountsPath: "result.portfolios",
    accountCode: "portfolioRef",
    accountName: "label",
    accountType: "kind",
    labelPaths: ["result.owner.fullName"],
  },
  history: {
    accountParam: "pf",
    cursorParam: "page",
    itemsPath: "items",
    nextCursorPath: "paging.next",
    hasNextPath: "paging.more",
    maxPages: 50,
  },
  pending: { accountParam: "pf", itemsPath: "items" },
};

const ALT_EXPORT = {
  source: "altbroker",
  accounts: [
    {
      account_code: "PF1",
      history: [
        {
          dealId: "a1",
          txnKind: "BOT",
          symbol: "ZZZ-EQ",
          state: "DONE",
          dealDate: "2024-01-05",
          cashValue: 2000,
          shares: 100,
        },
        {
          dealId: "a2",
          txnKind: "SWAP",
          symbol: "ZZZ-EQ",
          state: "DONE",
          dealDate: "2024-02-05",
          cashValue: 1500,
          shares: 75,
          intoSymbol: "YYY-BOND",
          intoCash: 1500,
          intoShares: 150,
        },
        {
          dealId: "a3",
          txnKind: "DIV",
          symbol: "ZZZ-EQ",
          state: "DONE",
          dealDate: "2024-03-05",
          cashValue: 50,
        },
        {
          dealId: "a4",
          txnKind: "SLD",
          symbol: "ZZZ-EQ",
          state: "VOID", // cancelled → dropped
          dealDate: "2024-04-05",
          cashValue: 999,
          shares: 10,
        },
      ],
    },
  ],
};

describe("parseBrokerExport (custom shape — genericity)", () => {
  const res = parseBrokerExport(ALT_EXPORT, ALT_SHAPE);

  it("reads renamed order fields/values: buy + switch(2) + dividend = 4, void dropped", () => {
    expect(res.stats.imported).toBe(4);
    expect(res.stats.switches).toBe(1);
    expect(res.stats.dividends).toBe(1);
    expect(res.stats.skippedCancel).toBe(1);
  });

  it("maps a renamed switch to sell(out) + buy(in)", () => {
    const sell = res.rows.find((r) => r.ticker === "ZZZ-EQ" && r.kind === "sell");
    const buy = res.rows.find((r) => r.ticker === "YYY-BOND");
    expect(sell).toMatchObject({ kind: "sell", units: 75, amount: 1500, tradeDate: "2024-02-05" });
    expect(buy).toMatchObject({ kind: "buy", units: 150, amount: 1500, tradeDate: "2024-02-05" });
  });

  it("records the renamed dividend as cash with no unit delta", () => {
    const div = res.rows.find((r) => r.kind === "dividend");
    expect(div).toMatchObject({ ticker: "ZZZ-EQ", amount: 50 });
    expect(div?.units).toBeUndefined();
  });

  it("stamps externalId from the renamed ref field", () => {
    const buy = res.rows.find((r) => r.ticker === "ZZZ-EQ" && r.kind === "buy");
    expect(buy?.externalId).toBe("altbroker:PF1:a1");
    expect(buy?.externalAccount).toBe("PF1");
  });
});

describe("looksLikeBrokerExport", () => {
  it("recognizes export shapes, rejects the line-paste format", () => {
    expect(looksLikeBrokerExport(JSON.stringify(EXPORT))).toBe(true);
    expect(looksLikeBrokerExport(JSON.stringify({ history: [] }))).toBe(true);
    expect(looksLikeBrokerExport(JSON.stringify([{ order_type: "buy" }]))).toBe(true);
    expect(looksLikeBrokerExport("AAA-FUND, 100, 25.00")).toBe(false);
    expect(looksLikeBrokerExport("")).toBe(false);
  });
});

describe("resolveCollectorShape", () => {
  it("fills the built-in field paths when no shape is given", () => {
    const s = resolveCollectorShape();
    expect(s.plan.accountsPath).toBe("data.accounts");
    expect(s.plan.accountCode).toBe("agent_account_id");
    expect(s.history.nextCursorPath).toBe("pagination.next_cursor");
    expect(s.pending.accountParam).toBe("account_code");
  });

  it("merges a custom shape over the defaults (genericity)", () => {
    const s = resolveCollectorShape(ALT_SHAPE);
    expect(s.plan.accountsPath).toBe("result.portfolios");
    expect(s.plan.accountCode).toBe("portfolioRef");
    expect(s.history.accountParam).toBe("pf");
    expect(s.history.nextCursorPath).toBe("paging.next");
  });
});

describe("buildUserscript (self-updating loader)", () => {
  const endpoints = {
    host: "orders.example.com",
    planPath: "/api/plan",
    historyPath: "/api/history",
    pendingPath: "/api/pending",
    sourceTag: "broker",
  };

  it("emits a metadata header with @match host, @connect, @grant", () => {
    const us = buildUserscript(endpoints, "https://macrotide.example", "deadbeef");
    expect(us.startsWith("// ==UserScript==")).toBe(true);
    expect(us).toContain("// @match        https://orders.example.com/*");
    expect(us).toContain("// @connect      macrotide.example");
    expect(us).toContain("// @grant        GM_xmlhttpRequest");
  });

  it("bakes in only origin + token + loader version, no placeholders left", () => {
    const us = buildUserscript(endpoints, "https://macrotide.example", "deadbeef");
    expect(us).toContain('"deadbeef"');
    expect(us).toContain('"https://macrotide.example"');
    expect(us).toContain("GM_xmlhttpRequest");
    expect(us).toContain(`LV=${COLLECTOR_PROTOCOL_VERSION}`);
    expect(us).not.toMatch(/__[A-Z]+__/);
  });

  it("fetches its config from /runtime at run time, then posts to /ingest", () => {
    const us = buildUserscript(endpoints, "https://macrotide.example", "deadbeef");
    expect(us).toContain("/api/import/broker/runtime");
    expect(us).toContain("/api/import/broker/ingest");
    expect(us).toContain('"X-Import-Token"');
  });

  it("does NOT bake the endpoints or shape into the loader (they come from /runtime)", () => {
    const us = buildUserscript(endpoints, "https://macrotide.example", "x");
    // Endpoint paths + shape are runtime config now, not baked into the script body.
    expect(us).not.toContain('"/api/plan"');
    expect(us).not.toContain('"data.accounts"');
    expect(us).not.toContain("agent_account_id");
  });
});
