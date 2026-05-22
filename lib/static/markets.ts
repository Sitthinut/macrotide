import type { Markets } from "@/lib/mock/types";

// Editorial market chrome (indices snapshot, news cards, daily digest).
// Live SET / global indices come from /api/market/indices; the news + digest
// here are placeholders until Phase 3b wires a real news source.
export const MARKETS: Markets = {
  indices: [
    { sym: "SET", name: "SET Index", val: 1428.42, d: -0.62 },
    { sym: "S&P 500", name: "S&P 500", val: 5821.1, d: 0.31 },
    { sym: "NASDAQ", name: "Nasdaq Comp.", val: 18942.8, d: 0.62 },
    { sym: "MSCI ACWI", name: "MSCI All-World", val: 824.55, d: 0.18 },
    { sym: "Gold", name: "Gold (USD/oz)", val: 2412.4, d: -0.21 },
    { sym: "10Y UST", name: "US 10Y Yield", val: 4.18, d: 0.03, isYield: true },
  ],

  news: [
    {
      tag: "RATES",
      time: "2h ago",
      title: "Fed signals pause; dollar softens",
      summary:
        "FOMC minutes hint at extended hold; emerging-market equities catch a bid as DXY drops 0.6%.",
      impact:
        "Tailwind for your US holdings (SCBS&P500, K-USA-A) and reduces FX drag on Thai-listed global funds.",
      relevance: "high",
    },
    {
      tag: "THAILAND",
      time: "5h ago",
      title: "SET drifts lower on banking sector weakness",
      summary: "BBL, KBANK, SCB all down >1% after Q1 NIM compression. Tourism names hold up.",
      impact: "Your ABSM position is down -0.85% today, dragging Thai equity sleeve to -4.2% YTD.",
      relevance: "high",
    },
    {
      tag: "GLOBAL",
      time: "Yesterday",
      title: "Megacap tech earnings beat; AI capex still climbing",
      summary:
        "MSFT, GOOGL, META reaffirm cloud and AI spend through 2027. Concentration risk in cap-weighted indices.",
      impact:
        "Boosts your S&P 500 and World Equity Index holdings — but 32% of those funds now sit in 10 names.",
      relevance: "medium",
    },
    {
      tag: "MACRO",
      time: "Yesterday",
      title: "Oil pulls back to $74 on demand worries",
      summary: "OPEC+ holds output steady; China import data soft.",
      impact:
        "Mildly negative for KKP-GINFRA's energy infra exposure (~12% of fund). Not material at your sizing.",
      relevance: "low",
    },
    {
      tag: "BONDS",
      time: "2d ago",
      title: "Thai 10Y yield steady at 2.41% after BOT meeting",
      summary: "Policy rate held at 2.25%. Inflation print due Friday.",
      impact: "K-FIXED running +2.1% YTD — on track. Carry remains attractive vs cash.",
      relevance: "medium",
    },
  ],

  digest:
    "Markets are doing what markets do — small ranges, mixed signals. Your US-heavy tilt has been the right call this year (+11.2% on SCBS&P500). The Thai equity drag is real but small (7.5% of book). Nothing requires action today; one thing worth watching: concentration in megacap tech across three of your funds.",
};
