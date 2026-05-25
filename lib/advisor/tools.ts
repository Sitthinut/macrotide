// AI SDK tool surface for advisor actions. These give the chat model
// READ access to the user's real portfolio / plan / journal, a WRITE for
// journal notes, and a single PROPOSE tool for plan edits that does NOT mutate
// — it emits a proposal the ChatScreen renders as a PlanProposalCard, applied
// only when the user clicks Accept (see lib/portfolio/apply-plan-edit.ts and
// POST /api/plan/edit). Mirrors the AI SDK `tool()` shape used by the memory
// tools (lib/memory/tools.ts).
//
// All reads/writes resolve through the request's DB context, so they're
// automatically per-user scoped (ownedBy/ownerId) — never bypass it.
import { tool } from "ai";
import { z } from "zod";
import { listBuckets } from "../db/queries/buckets";
import { findFunds, getCheaperAlternatives, getFundsByAbbr } from "../db/queries/funds";
import { listHoldings } from "../db/queries/holdings";
import { createJournalEntry, type JournalKind, listJournalEntries } from "../db/queries/journal";
import { getModelPortfolio } from "../db/queries/models";
import { getPlan } from "../db/queries/plan";
import { listFundQuotes } from "../db/queries/quotes";
import { getPortfolioSeries } from "../db/queries/series";
import { BENCHMARK_OPTIONS, getBenchmarkReturnPct } from "../market/benchmarks";
import { QUOTE_SOURCES } from "../market/sources";
import { adaptModelPortfolio, adaptPortfolios } from "../portfolio/adapter";
import { computeHealth, summarizeHealth } from "../portfolio/health";
import { parsePlan } from "../portfolio/plan-parser";

const JOURNAL_KINDS = ["note", "decision", "question", "reading"] as const;
const PERF_RANGES = ["1mo", "3mo", "6mo", "1y", "5y", "max"] as const;

export interface AdvisorToolOptions {
  // Single owner: null. Multi-user threads the authenticated user id.
  // Carried for symmetry with createMemoryTools; the query layer reads the
  // owner from the DB context (ownedBy), so we don't pass it down explicitly.
  userId: string | null;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function createAdvisorTools({ userId }: AdvisorToolOptions) {
  void userId; // scoping is enforced by the DB context, not this argument.

  const read_portfolio = tool({
    description:
      "Read the user's REAL portfolio: total value, allocation by asset class " +
      "and region, per-sleeve drift from their target model, blended (value-" +
      "weighted) expense ratio, concentration (largest holding, top-3, HHI), " +
      "and cash drag. Use this before answering anything about how they're " +
      "doing, their mix, fees, concentration, or rebalancing. Numbers are " +
      "computed deterministically from holdings — never invent figures.",
    inputSchema: z.object({}),
    execute: async () => {
      const buckets = listBuckets();
      const holdings = listHoldings();
      const quotes = listFundQuotes();
      const portfolios = adaptPortfolios(buckets, holdings, quotes);
      const allHoldings = portfolios.flatMap((p) => p.holdings);
      const totalValue = allHoldings.reduce((s, h) => s + h.value, 0);

      const plan = getPlan();
      const model = plan?.selectedModelId ? getModelPortfolio(plan.selectedModelId) : undefined;
      const target = model ? adaptModelPortfolio(model) : null;

      const health = computeHealth(
        allHoldings,
        totalValue,
        target?.mix ?? null,
        target?.ter ?? null,
      );
      const headline = summarizeHealth(health, target?.name ?? null);

      return {
        ok: true as const,
        hasHoldings: allHoldings.length > 0,
        totalValue: round(totalValue),
        baseCurrency: "THB",
        targetModel: target?.name ?? null,
        byClass: health.byClass.map((s) => ({ label: s.label, pct: round(s.pct, 1) })),
        byRegion: health.byRegion.map((s) => ({ label: s.label, pct: round(s.pct, 1) })),
        drift: health.drift.map((d) => ({
          ticker: d.ticker,
          label: d.label,
          current: round(d.current, 1),
          target: round(d.target, 1),
          drift: round(d.drift, 1),
        })),
        trackingGapPp: health.trackingGapPp,
        blendedTer: round(health.blendedTer, 3),
        targetTer: health.targetTer,
        concentration: {
          top: health.concentration.top
            ? {
                ticker: health.concentration.top.ticker,
                label: health.concentration.top.label,
                pct: round(health.concentration.top.pct, 1),
              }
            : null,
          top3Pct: round(health.concentration.top3Pct, 1),
          hhi: round(health.concentration.hhi, 3),
          holdingCount: health.concentration.holdingCount,
        },
        cashPct: round(health.cashPct, 1),
        headline: { tone: headline.tone, title: headline.title, body: headline.body },
        message: allHoldings.length
          ? `Read ${allHoldings.length} holding(s) across ${buckets.length} bucket(s); total ฿${round(totalValue).toLocaleString()}.`
          : "The user has no holdings yet — suggest adding some before analysis.",
      };
    },
  });

  const read_performance = tool({
    description:
      "Read how the user's portfolio has PERFORMED over a period: its value at " +
      "the start and end of the range, the total return %, AND the same-period " +
      "return of reference indices (SET, S&P 500) — so you can answer 'am I " +
      "matching / beating my index?' with real numbers. Call this for any " +
      "question about returns, performance, or keeping up with an index. " +
      "Computed from the user's real NAV history; never invent performance " +
      "figures. Benchmark returns are best-effort — if an index is temporarily " +
      "unavailable its return comes back null; say so rather than guessing.",
    inputSchema: z.object({
      range: z.enum(PERF_RANGES).optional().describe("Look-back window; default 6mo."),
    }),
    execute: async ({ range }) => {
      const r = range ?? "6mo";
      const { aggregate, asOf } = getPortfolioSeries(r);
      if (aggregate.length < 2) {
        return {
          ok: true as const,
          hasData: false,
          range: r,
          message:
            "Not enough NAV history to compute a return yet — needs at least two priced dates.",
        };
      }
      const first = aggregate[0];
      const last = aggregate[aggregate.length - 1];
      const periodReturnPct = first.value
        ? round(((last.value - first.value) / first.value) * 100)
        : null;

      // Compare against the SET (the core "match your index" reference) and the
      // S&P 500, over the SAME window (aligned to the portfolio's first date).
      const benchmarks = await Promise.all(
        (["set", "sp500"] as const).map(async (key) => {
          const ret = await getBenchmarkReturnPct(key, r, first.date);
          const opt = BENCHMARK_OPTIONS.find((b) => b.key === key);
          return {
            key,
            label: opt?.label ?? key,
            returnPct: ret == null ? null : round(ret),
            beating: ret == null || periodReturnPct == null ? null : periodReturnPct >= ret,
          };
        }),
      );

      const fmt = (n: number | null) => (n == null ? "n/a" : `${n >= 0 ? "+" : ""}${n}%`);
      return {
        ok: true as const,
        hasData: true,
        range: r,
        startDate: first.date,
        endDate: last.date,
        startValue: round(first.value),
        endValue: round(last.value),
        periodReturnPct,
        asOf,
        benchmarks,
        message:
          `Portfolio ${fmt(periodReturnPct)} over ${r} (${first.date}→${last.date}). ` +
          `Benchmarks: ${benchmarks.map((b) => `${b.label} ${fmt(b.returnPct)}`).join(", ")}.`,
      };
    },
  });

  const read_plan = tool({
    description:
      "Read the user's written investing plan (markdown) plus its parsed spine " +
      "sections (target, principles, risk, commitments) and any extra sections. " +
      "Use this before referencing or proposing changes to their plan, so you " +
      "don't duplicate something already there.",
    inputSchema: z.object({}),
    execute: async () => {
      const plan = getPlan();
      const markdown = plan?.markdown ?? "";
      const parsed = parsePlan(markdown);
      return {
        ok: true as const,
        hasPlan: markdown.trim().length > 0,
        markdown,
        spine: parsed.spine,
        extras: parsed.extras,
        selectedModelId: plan?.selectedModelId ?? null,
        message: markdown.trim()
          ? "Loaded the user's plan."
          : "The user hasn't written a plan yet — offer to help them start one.",
      };
    },
  });

  const read_journal = tool({
    description:
      "Read the user's investing journal entries. Optionally filter by kind " +
      "(note/decision/question/reading), a tag, and a since-date. Use this to " +
      "recall past decisions, open questions, or reading before answering.",
    inputSchema: z.object({
      kind: z.enum(JOURNAL_KINDS).optional().describe("Restrict to one entry kind."),
      tag: z.string().min(1).optional().describe("Only entries carrying this tag."),
      since: z
        .string()
        .optional()
        .describe("ISO date (e.g. '2026-01-01'); only entries created on/after it."),
      limit: z.number().int().positive().max(50).optional().describe("Max entries (default 20)."),
    }),
    execute: async ({ kind, tag, since, limit }) => {
      const rows = listJournalEntries({
        kind: kind as JournalKind | undefined,
        since,
        limit: tag ? undefined : (limit ?? 20),
      });
      const filtered = tag ? rows.filter((r) => (r.tags ?? []).includes(tag)) : rows;
      const sliced = tag ? filtered.slice(0, limit ?? 20) : filtered;
      return {
        ok: true as const,
        count: sliced.length,
        entries: sliced.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          body: r.body,
          tags: r.tags ?? [],
          createdAt: r.createdAt,
        })),
        message:
          sliced.length === 0
            ? "No matching journal entries."
            : `Found ${sliced.length} journal entr${sliced.length === 1 ? "y" : "ies"}.`,
      };
    },
  });

  const write_journal = tool({
    description:
      "Save a new entry to the user's investing journal. Use when the user " +
      "makes a decision, asks you to log something, or records an open question " +
      "or reading. Choose the most fitting kind. Confirm with the returned " +
      "message.",
    inputSchema: z.object({
      kind: z
        .enum(JOURNAL_KINDS)
        .describe(
          "note = general observation; decision = a choice they've made; " +
            "question = an open question to revisit; reading = an article/resource.",
        ),
      title: z.string().max(200).optional().describe("Optional short title."),
      body: z.string().min(1).max(4000).describe("The entry content."),
      tags: z.array(z.string().min(1)).max(10).optional().describe("Optional tags."),
    }),
    execute: async ({ kind, title, body, tags }) => {
      const row = createJournalEntry({
        kind,
        title: title ?? null,
        body,
        tags: tags ?? null,
        source: "advisor_tool",
        pinned: false,
      });
      return {
        ok: true as const,
        id: row.id,
        kind: row.kind,
        message: `Saved to your journal as a ${kind}${title ? `: "${title}"` : ""}.`,
      };
    },
  });

  const propose_plan_edit = tool({
    description:
      "Propose an addition to the user's written plan. This does NOT change the " +
      "plan — it shows the user a proposal card they can Accept or dismiss. Use " +
      "it whenever the user wants to add a rule, principle, risk note, target, " +
      "or commitment to their plan. Read the plan first (read_plan) so you put " +
      "the line in the right section and don't duplicate. After calling this, " +
      "tell the user you've drafted the change for them to confirm.",
    inputSchema: z.object({
      section: z
        .string()
        .min(1)
        .describe(
          "The plan section to add to (e.g. 'Principles', 'Risk', " +
            "'Commitments', 'Target'). Created if it doesn't exist.",
        ),
      add: z
        .string()
        .min(1)
        .describe("The line to add, WITHOUT a leading bullet — it's added as a list item."),
      rationale: z
        .string()
        .min(1)
        .max(500)
        .describe("One short sentence explaining why, shown on the proposal card."),
    }),
    execute: async ({ section, add, rationale }) => {
      // Normalize to a markdown bullet, matching the existing card/diff shape.
      const line = add.trim().replace(/^[-*]\s*/, "");
      // The `proposal` field carries the exact PlanProposal shape ChatScreen's
      // card expects ({ section, rationale, add, rm }). The client picks it off
      // the tool output in the stream and renders the card; accept flows
      // through POST /api/plan/edit (persistPlanEdit). No DB mutation here.
      const proposal = {
        section,
        rationale,
        add: `- ${line}`,
        rm: null as string | null,
      };
      return {
        ok: true as const,
        proposal,
        message: `Drafted a change to your ${section} section — confirm on the card to apply it.`,
      };
    },
  });

  const propose_holding = tool({
    description:
      "Propose adding ONE holding (fund/ETF/stock position) to the user's " +
      "portfolio. This does NOT write anything — it shows the user a " +
      "HoldingProposalCard they can Accept or dismiss; the row is saved only on " +
      "Accept (POST /api/holdings/propose, per-user scoped). Call this ONCE PER " +
      "POSITION when extracting holdings from a brokerage statement / OCR " +
      "transcription, or when the user describes a position to add. Use the " +
      "ticker exactly as shown; put the human-readable fund/stock name in " +
      "englishName. If you can read a unit count use it; if the statement only " +
      "shows a market value and a NAV/price, set units = value / price and put " +
      "that price in avgCost. Don't invent numbers you can't read — omit a field " +
      "rather than guess. Choose bucketId from the user's existing buckets — call " +
      "read_portfolio to see them and pick the one that fits by context (e.g. an " +
      "SSF bucket for an SSF fund). If the user has more than one bucket and the " +
      "right one isn't clear, ASK which bucket before proposing rather than " +
      "guessing. After proposing, tell the user you've drafted the row(s) for " +
      "them to confirm.",
    inputSchema: z.object({
      ticker: z
        .string()
        .min(1)
        .max(40)
        .describe("Fund/ETF/stock symbol exactly as shown (e.g. 'K-USA-A(A)', 'VOO')."),
      englishName: z
        .string()
        .min(1)
        .max(200)
        .describe("Human-readable fund/stock name (e.g. 'S&P 500 ETF'). Falls back to the ticker."),
      thaiName: z.string().max(200).optional().describe("Thai name if the statement shows one."),
      units: z
        .number()
        .positive()
        .describe("Number of units/shares held. Required — derive from value/price if needed."),
      avgCost: z
        .number()
        .positive()
        .optional()
        .describe("Average cost or NAV/price per unit, if the statement shows it."),
      ter: z.number().min(0).optional().describe("Total expense ratio as a fraction (e.g. 0.003)."),
      assetClass: z
        .enum(["equity", "bond", "alternative", "cash"])
        .optional()
        .describe("Asset class if you can infer it from the fund name; otherwise omit."),
      region: z.string().max(60).optional().describe("Region/geography if inferable (e.g. 'US')."),
      quoteSource: z
        .enum(QUOTE_SOURCES)
        .optional()
        .describe(
          "Price source: 'thai_mutual_fund' for SEC-registered Thai mutual funds, " +
            "'yahoo' for stocks/ETFs/indices. Defaults to 'yahoo'.",
        ),
      bucketId: z
        .string()
        .optional()
        .describe(
          "Target portfolio bucket id, chosen from the user's existing buckets " +
            "(see read_portfolio) by context. If you're unsure which of several " +
            "buckets fits, ask the user first rather than guessing. If omitted, " +
            "the accept path falls back to the user's first bucket.",
        ),
      source: z
        .string()
        .max(80)
        .optional()
        .describe("Provenance label shown in the UI (e.g. brokerage name)."),
      rationale: z
        .string()
        .min(1)
        .max(300)
        .describe("One short line shown on the card (e.g. what statement line this came from)."),
    }),
    execute: async (input) => {
      // The `holding` field carries the shape the HoldingProposalCard expects
      // and that POST /api/holdings/propose accepts. The client picks it off the
      // tool output in the stream and renders the card; accept flows through the
      // route (applyHoldingProposal). No DB mutation here.
      const holding = {
        ticker: input.ticker.trim().toUpperCase(),
        englishName: input.englishName.trim(),
        thaiName: input.thaiName?.trim() ?? null,
        units: input.units,
        avgCost: input.avgCost ?? null,
        ter: input.ter ?? null,
        assetClass: input.assetClass ?? null,
        region: input.region?.trim() ?? null,
        quoteSource: input.quoteSource ?? "yahoo",
        bucketId: input.bucketId?.trim() ?? null,
        source: input.source?.trim() ?? null,
        rationale: input.rationale,
      };
      return {
        ok: true as const,
        holding,
        message: `Drafted ${holding.ticker}${
          Number.isFinite(holding.units) ? ` (${holding.units} units)` : ""
        } — confirm on the card to add it to your portfolio.`,
      };
    },
  });

  // ─── fee-aware fund finder ─────────────────────────────────────────────────
  //
  // STANCE: Macrotide is an index-investing companion, not a stock picker. These
  // tools help the advisor answer "which low-fee fund gives me exposure X?" —
  // always proposing funds over individual stocks, always leading with fee as the
  // controllable edge. See docs/explanation/product-direction.md "Index-purist
  // stance" for the full rationale. The descriptions below are deliberately
  // written to steer the model toward fee-first, index-first framing.

  const find_funds = tool({
    description:
      "Search the SEC-registered Thai mutual fund catalog and return funds that " +
      "match a TARGET EXPOSURE, sorted CHEAPEST FIRST by their all-in annual fee " +
      "(TER). Use this tool whenever the user asks 'which fund gives me [exposure]', " +
      "'what's the lowest-fee S&P 500 / global / bond fund', 'cheapest index fund', " +
      "'cheapest SSF equity fund', or needs a concrete fund recommendation. " +
      "The fee is THE controllable edge for an index investor — this tool names the " +
      "best-value option for any exposure. " +
      "Use indexOnly=true to restrict to passive/index-tracking funds (management " +
      "style PN or PM) — always prefer these when the user wants market-cap exposure. " +
      "Use taxIncentive to find SSF/ThaiESG/RMF wrappers, which add tax deductibility " +
      "on top of the fee advantage. " +
      "IMPORTANT: Macrotide is an index-investing companion. When the user asks about " +
      "an individual stock or hot theme (e.g. 'should I buy NVIDIA'), do NOT use this " +
      "tool to find that stock — instead call find_funds for the closest low-fee " +
      "index or thematic fund that captures the same exposure, then explain why a " +
      "diversified fund beats picking a single name.",
    inputSchema: z.object({
      assetClass: z
        .enum(["equity", "bond", "alternative", "cash"])
        .optional()
        .describe(
          "Asset class filter. Use 'equity' for stock index funds, 'bond' for fixed-income, " +
            "'alternative' for REITs / gold / commodity funds, 'cash' for money-market.",
        ),
      indexOnly: z
        .boolean()
        .optional()
        .describe(
          "When true, restrict results to index / passive funds (management style PN or PM). " +
            "Always prefer this for market-cap exposure questions — index funds have lower fees " +
            "and no active management risk.",
        ),
      taxIncentive: z
        .enum(["SSF", "ThaiESG", "RMF"])
        .optional()
        .describe(
          "Filter by Thai tax-advantaged wrapper. SSF = Super Savings Fund (deduct up to 30% " +
            "of income, max 200,000 THB); ThaiESG = Thai ESG Fund (deduct up to 30%, max 300,000 THB); " +
            "RMF = Retirement Mutual Fund (deduct up to 30%, max 500,000 THB). " +
            "Tax efficiency is part of net return — mention the wrapper when recommending these.",
        ),
      region: z
        .enum(["foreign", "domestic", "mixed"])
        .optional()
        .describe(
          "Geographic mandate: 'foreign' for funds investing outside Thailand (feeder funds, " +
            "global index funds), 'domestic' for Thai-only exposure, 'mixed' for blended mandate.",
        ),
      query: z
        .string()
        .optional()
        .describe(
          "Free-text search against fund name and investment-policy text. Good for finding " +
            "funds by index (e.g. 'S&P 500', 'MSCI World') or theme (e.g. 'gold', 'REIT'). " +
            "Combine with assetClass for best results.",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .max(30)
        .optional()
        .describe("Max funds to return (default 10). Keep this small — present the top options."),
    }),
    execute: async ({ assetClass, indexOnly, taxIncentive, region, query, limit }) => {
      const funds = findFunds({
        assetClass,
        indexOnly,
        taxIncentive,
        region,
        query,
        activeOnly: true,
        excludeFixedTerm: true,
        limit: limit ?? 10,
      });

      if (funds.length === 0) {
        return {
          ok: true as const,
          count: 0,
          funds: [],
          message:
            "No funds found for that filter. Try a broader query, drop the asset-class filter, " +
            "or relax the indexOnly / taxIncentive / region constraints.",
        };
      }

      const items = funds.map((f) => ({
        projId: f.projId,
        abbr: f.abbrName ?? f.projId,
        englishName: f.englishName ?? null,
        amc: f.amcName ?? null,
        assetClass: f.assetClass ?? null,
        // TER is the headline fee — the all-in annual cost as a percent.
        // Null means the SEC hasn't published a Total Fee and Expense for this fund.
        terPct: f.ter,
        terLabel: f.ter == null ? "TER not published" : `${f.ter.toFixed(2)}% p.a.`,
        // Enrichment fields — the advisor uses these to describe the fund accurately.
        managementStyle: f.managementStyle ?? null,
        isIndex: f.managementStyle === "PN" || f.managementStyle === "PM",
        taxIncentiveType: f.taxIncentiveType ?? null,
        distributionPolicy: f.distributionPolicy ?? null,
        investRegion: f.investRegion ?? null,
        isFeederFund: f.isFeederFund,
        feederMasterFund: f.feederMasterFund ?? null,
      }));

      const cheapest = items[0];
      const hasTer = items.filter((i) => i.terPct != null).length;
      const indexCount = items.filter((i) => i.isIndex).length;

      const contextNote =
        indexOnly && indexCount > 0
          ? `All ${indexCount} result${indexCount === 1 ? "" : "s"} are index/passive funds. `
          : indexCount > 0
            ? `${indexCount} of ${items.length} are index/passive funds (marked isIndex=true). `
            : "";

      return {
        ok: true as const,
        count: funds.length,
        funds: items,
        cheapestAbbr: cheapest.abbr,
        message:
          `Found ${funds.length} fund${funds.length === 1 ? "" : "s"} — sorted cheapest first. ` +
          contextNote +
          (hasTer > 0
            ? `Lowest TER: ${cheapest.terLabel} (${cheapest.abbr}). ` +
              "Fee is the single most controllable factor in long-run return — " +
              "lead with the cheapest option that matches the target exposure."
            : "No TER data available for these funds — suggest the user verify fees " +
              "on the fund factsheet before committing."),
      };
    },
  });

  const find_cheaper_alternatives = tool({
    description:
      "Given a fund the user already holds (by ticker/abbr or SEC project id), find " +
      "cheaper funds in the same asset class or category — strictly lower TER, " +
      "ranked lowest-fee first. Use this to surface the 'fee-creep' opportunity: " +
      "'you hold X at Y% TER; here are cheaper funds with the same exposure.' " +
      "Call read_portfolio first to see the user's holdings and identify candidates. " +
      "Always present the fee delta prominently — it compounds against the user every year.",
    inputSchema: z.object({
      fundAbbr: z
        .string()
        .optional()
        .describe(
          "The fund's abbreviated ticker/symbol (e.g. 'K-USA-A(A)'). " +
            "Provide this OR projId — not both.",
        ),
      projId: z
        .string()
        .optional()
        .describe("The SEC project id (e.g. 'M0017_2538'). Provide this OR fundAbbr — not both."),
      limit: z
        .number()
        .int()
        .positive()
        .max(10)
        .optional()
        .describe("Max alternatives to return (default 5)."),
    }),
    execute: async ({ fundAbbr, projId, limit }) => {
      // Resolve projId from abbr if needed.
      let resolvedProjId = projId?.trim();
      let resolvedAbbr = fundAbbr?.trim();

      if (!resolvedProjId && resolvedAbbr) {
        const matches = getFundsByAbbr([resolvedAbbr]);
        if (matches.length === 0) {
          return {
            ok: true as const,
            count: 0,
            alternatives: [],
            message:
              `Could not find a fund with abbreviation "${resolvedAbbr}" in the catalog. ` +
              "The daily SEC refresh may not have run yet, or the abbreviation may differ from " +
              "what's in the catalog. Try the SEC project id instead.",
          };
        }
        resolvedProjId = matches[0].projId;
        resolvedAbbr = matches[0].abbrName ?? resolvedAbbr;
      }

      if (!resolvedProjId) {
        return {
          ok: false as const,
          count: 0,
          alternatives: [],
          message: "Provide either fundAbbr or projId.",
        };
      }

      const peers = getCheaperAlternatives(resolvedProjId, limit ?? 5);

      if (peers.length === 0) {
        // Distinguish between "ref fund not found / no TER" vs "already the cheapest".
        return {
          ok: true as const,
          count: 0,
          alternatives: [],
          referenceAbbr: resolvedAbbr ?? resolvedProjId,
          message:
            peers.length === 0
              ? `No cheaper alternatives found for ${resolvedAbbr ?? resolvedProjId}. ` +
                "Either it's already the lowest-fee option in its class, or the catalog " +
                "doesn't have TER data for this fund yet."
              : "",
        };
      }

      // We need the reference TER to compute deltas.
      // getCheaperAlternatives already filtered to strictly-cheaper; the ref TER
      // is peers[0].ter + delta, but we don't have it directly here. Re-resolve.
      const refFunds = getFundsByAbbr(resolvedAbbr ? [resolvedAbbr] : []);
      const refProjIdFinal = resolvedProjId;
      // Get ref TER from the first peer's ter vs the position — use the query result
      // shape: peers are sorted cheapest-first and all have ter < refTer.
      // We don't have refTer directly without calling getCurrentTer again, but
      // we can infer it from the result list's context. For the message we
      // compute an approximate delta from cheapest peer.
      const cheapestPeer = peers[0];

      const items = peers.map((f) => ({
        projId: f.projId,
        abbr: f.abbrName ?? f.projId,
        englishName: f.englishName ?? null,
        amc: f.amcName ?? null,
        assetClass: f.assetClass ?? null,
        terPct: f.ter,
        terLabel: f.ter == null ? "TER not published" : `${f.ter.toFixed(2)}% p.a.`,
        managementStyle: f.managementStyle ?? null,
        isIndex: f.managementStyle === "PN" || f.managementStyle === "PM",
        taxIncentiveType: f.taxIncentiveType ?? null,
        investRegion: f.investRegion ?? null,
        isFeederFund: f.isFeederFund,
        feederMasterFund: f.feederMasterFund ?? null,
      }));

      void refFunds; // used for projId resolution only
      void refProjIdFinal;

      return {
        ok: true as const,
        count: peers.length,
        alternatives: items,
        referenceAbbr: resolvedAbbr ?? resolvedProjId,
        cheapestAlternativeAbbr: cheapestPeer.abbrName ?? cheapestPeer.projId,
        message:
          `Found ${peers.length} cheaper alternative${peers.length === 1 ? "" : "s"} for ` +
          `${resolvedAbbr ?? resolvedProjId} — all with lower TER, sorted cheapest first. ` +
          `Best: ${cheapestPeer.abbrName ?? cheapestPeer.projId} at ` +
          `${cheapestPeer.ter?.toFixed(2) ?? "?"}% p.a. ` +
          "Even a 0.5% TER difference compounds materially over a 10-year horizon — " +
          "present this as the fee-creep opportunity and offer to propose a switch.",
      };
    },
  });

  return {
    read_portfolio,
    read_performance,
    read_plan,
    read_journal,
    write_journal,
    propose_plan_edit,
    propose_holding,
    find_funds,
    find_cheaper_alternatives,
  };
}

export type AdvisorTools = ReturnType<typeof createAdvisorTools>;
