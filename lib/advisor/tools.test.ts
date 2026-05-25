import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it } from "vitest";
import { runWithDbContext } from "../db/context";
import { createBucket } from "../db/queries/buckets";
import { createHolding, listHoldings } from "../db/queries/holdings";
import { listJournalEntries } from "../db/queries/journal";
import { getPlan, upsertPlan } from "../db/queries/plan";
import * as schema from "../db/schema";
import { persistPlanEdit } from "../portfolio/apply-plan-edit";
import { createAdvisorTools } from "./tools";

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

function withFresh<T>(fn: () => T): T {
  const { sqlite, db } = freshDb();
  return runWithDbContext({ db, sqlite, isDemo: true, sessionId: "test" }, fn) as T;
}

const BUCKET = {
  id: "core",
  name: "Core",
  typeLabel: "Free",
  icon: "○",
  color: "#3b82f6",
  brokerage: "FNDQ",
  notes: null,
  goalText: null,
  targetModelId: null,
  targetAllocation: null,
};

// Tools are invoked through the AI SDK at runtime; in tests we call the
// `execute` directly. `as never` because the SDK's tool type expects extra
// runtime args (toolCallId / messages) we don't supply in unit tests.
type Exec<T> = (args: T, opts?: never) => Promise<unknown>;

function run<T>(tool: { execute?: unknown }, args: T): Promise<unknown> {
  return (tool.execute as Exec<T>)(args);
}

describe("advisor tools — read_portfolio", () => {
  it("computes allocation, concentration, and blended TER from real holdings", async () => {
    const out = (await withFresh(async () => {
      createBucket(BUCKET);
      // value = units * avgCost (no quote seeded → falls back to avgCost).
      createHolding({
        bucketId: "core",
        ticker: "VOO",
        englishName: "S&P 500",
        units: 100,
        avgCost: 6, // value 600
        assetClass: "equity",
        region: "US",
        ter: 0.03,
      });
      createHolding({
        bucketId: "core",
        ticker: "BND",
        englishName: "Total Bond",
        units: 100,
        avgCost: 4, // value 400
        assetClass: "bond",
        region: "US",
        ter: 0.05,
      });
      const tools = createAdvisorTools({ userId: null });
      return run(tools.read_portfolio, {});
    })) as {
      ok: boolean;
      hasHoldings: boolean;
      totalValue: number;
      byClass: { label: string; pct: number }[];
      blendedTer: number;
      concentration: { top: { ticker: string; pct: number } | null; holdingCount: number };
    };

    expect(out.ok).toBe(true);
    expect(out.hasHoldings).toBe(true);
    expect(out.totalValue).toBe(1000);
    // 60% stocks / 40% bonds.
    const stocks = out.byClass.find((s) => s.label === "Stocks");
    expect(stocks?.pct).toBe(60);
    // Blended TER = (600*0.03 + 400*0.05) / 1000 = 0.038.
    expect(out.blendedTer).toBeCloseTo(0.038, 3);
    expect(out.concentration.holdingCount).toBe(2);
    expect(out.concentration.top?.ticker).toBe("VOO");
  });

  it("reports no holdings cleanly on an empty portfolio", async () => {
    const out = (await withFresh(async () => {
      const tools = createAdvisorTools({ userId: null });
      return run(tools.read_portfolio, {});
    })) as { hasHoldings: boolean; totalValue: number; message: string };
    expect(out.hasHoldings).toBe(false);
    expect(out.totalValue).toBe(0);
    expect(out.message).toMatch(/no holdings/i);
  });
});

describe("advisor tools — read_plan", () => {
  it("returns markdown plus parsed spine sections", async () => {
    const out = (await withFresh(async () => {
      upsertPlan({ markdown: "## Risk\n- max 30% drawdown\n\n## Principles\n- index only" });
      const tools = createAdvisorTools({ userId: null });
      return run(tools.read_plan, {});
    })) as { hasPlan: boolean; spine: { risk: string | null; principles: string | null } };
    expect(out.hasPlan).toBe(true);
    expect(out.spine.risk).toContain("30% drawdown");
    expect(out.spine.principles).toContain("index only");
  });
});

describe("advisor tools — journal", () => {
  it("write_journal persists and read_journal reads it back, filtered by tag", async () => {
    const out = (await withFresh(async () => {
      const tools = createAdvisorTools({ userId: null });
      await run(tools.write_journal, {
        kind: "decision",
        title: "Rebalanced",
        body: "Trimmed VOO back to target.",
        tags: ["rebalance"],
      });
      await run(tools.write_journal, {
        kind: "note",
        body: "Untagged note.",
      });
      const tagged = await run(tools.read_journal, { tag: "rebalance" });
      const decisions = await run(tools.read_journal, { kind: "decision" });
      return { tagged, decisions };
    })) as {
      tagged: { count: number; entries: { kind: string; tags: string[] }[] };
      decisions: { count: number };
    };
    expect(out.tagged.count).toBe(1);
    expect(out.tagged.entries[0].tags).toContain("rebalance");
    expect(out.decisions.count).toBe(1);
  });

  it("write_journal records advisor_tool source", async () => {
    const rows = await withFresh(async () => {
      const tools = createAdvisorTools({ userId: null });
      await run(tools.write_journal, { kind: "note", body: "logged by advisor" });
      return listJournalEntries();
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("advisor_tool");
  });
});

describe("advisor tools — propose_plan_edit", () => {
  it("emits a proposal in the card shape and does NOT mutate the plan", async () => {
    const result = await withFresh(async () => {
      upsertPlan({ markdown: "## Principles\n- index only" });
      const tools = createAdvisorTools({ userId: null });
      const out = (await run(tools.propose_plan_edit, {
        section: "Principles",
        add: "no individual stocks",
        rationale: "User wants funds only.",
      })) as { proposal: { section: string; add: string | null; rm: string | null } };
      const planAfter = getPlan();
      return { out, planAfter };
    });
    // Proposal carries the exact PlanProposal shape the card expects.
    expect(result.out.proposal.section).toBe("Principles");
    expect(result.out.proposal.add).toBe("- no individual stocks");
    expect(result.out.proposal.rm).toBeNull();
    // Crucially: proposing did NOT change the persisted plan.
    expect(result.planAfter?.markdown).toBe("## Principles\n- index only");
  });
});

describe("advisor tools — propose_holding", () => {
  it("emits a holding in the card shape and does NOT write a holding", async () => {
    const result = await withFresh(async () => {
      createBucket(BUCKET);
      const tools = createAdvisorTools({ userId: null });
      const out = (await run(tools.propose_holding, {
        ticker: "voo",
        englishName: "Vanguard S&P 500 ETF",
        units: 12.5,
        avgCost: 400,
        assetClass: "equity",
        region: "US",
        quoteSource: "yahoo",
        rationale: "Read from the statement.",
      })) as {
        ok: boolean;
        holding: {
          ticker: string;
          englishName: string;
          units: number;
          avgCost: number | null;
          assetClass: string | null;
          quoteSource: string;
          bucketId: string | null;
        };
      };
      // Proposing must not have written anything.
      const holdingsAfter = listHoldings();
      return { out, count: holdingsAfter.length };
    });
    expect(result.out.ok).toBe(true);
    // Ticker is normalized to upper-case in the proposal payload.
    expect(result.out.holding.ticker).toBe("VOO");
    expect(result.out.holding.englishName).toBe("Vanguard S&P 500 ETF");
    expect(result.out.holding.units).toBe(12.5);
    expect(result.out.holding.avgCost).toBe(400);
    expect(result.out.holding.assetClass).toBe("equity");
    expect(result.out.holding.quoteSource).toBe("yahoo");
    // Crucially: proposing did NOT insert a holding.
    expect(result.count).toBe(0);
  });

  it("defaults quoteSource to yahoo and nulls absent optional fields", async () => {
    const out = (await withFresh(async () => {
      const tools = createAdvisorTools({ userId: null });
      return run(tools.propose_holding, {
        ticker: "K-USA-A",
        englishName: "K US Equity",
        units: 100,
        rationale: "row 1",
      });
    })) as { holding: { quoteSource: string; avgCost: number | null; assetClass: string | null } };
    expect(out.holding.quoteSource).toBe("yahoo");
    expect(out.holding.avgCost).toBeNull();
    expect(out.holding.assetClass).toBeNull();
  });
});

describe("accept path — persistPlanEdit", () => {
  it("applies an additive edit into an existing section and persists it", async () => {
    const md = await withFresh(async () => {
      upsertPlan({ markdown: "## Principles\n- index only\n" });
      persistPlanEdit({ section: "Principles", add: "- no individual stocks", rm: null });
      return getPlan()?.markdown ?? "";
    });
    expect(md).toContain("- index only");
    expect(md).toContain("- no individual stocks");
  });

  it("creates the section when it doesn't exist and preserves selectedModelId", async () => {
    const plan = await withFresh(async () => {
      upsertPlan({ markdown: "## Principles\n- index only\n", selectedModelId: "balanced-60-40" });
      persistPlanEdit({ section: "Risk", add: "- max 30% drawdown", rm: null });
      return getPlan();
    });
    expect(plan?.markdown).toContain("## Risk");
    expect(plan?.markdown).toContain("- max 30% drawdown");
    // selectedModelId carried through the edit (not cleared).
    expect(plan?.selectedModelId).toBe("balanced-60-40");
  });
});
