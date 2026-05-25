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
import { listHoldings } from "../db/queries/holdings";
import { createJournalEntry, type JournalKind, listJournalEntries } from "../db/queries/journal";
import { getModelPortfolio } from "../db/queries/models";
import { getPlan } from "../db/queries/plan";
import { listFundQuotes } from "../db/queries/quotes";
import { QUOTE_SOURCES } from "../market/sources";
import { adaptModelPortfolio, adaptPortfolios } from "../portfolio/adapter";
import { computeHealth, summarizeHealth } from "../portfolio/health";
import { parsePlan } from "../portfolio/plan-parser";

const JOURNAL_KINDS = ["note", "decision", "question", "reading"] as const;

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

  return {
    read_portfolio,
    read_plan,
    read_journal,
    write_journal,
    propose_plan_edit,
    propose_holding,
  };
}

export type AdvisorTools = ReturnType<typeof createAdvisorTools>;
