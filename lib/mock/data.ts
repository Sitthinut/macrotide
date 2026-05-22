// Mock data for the investment agent prototype
// Realistic Thai mutual funds (commonly traded via Thai fund supermarkets).
// Brokerage / source fields use "Demo Broker" as a generic placeholder until
// a real integration is wired up.

import type {
  AggregatePortfolio,
  AIPersonality,
  Analysis,
  BenchmarkKey,
  Breakdown,
  LearnContent,
  Markets,
  ModelPortfolio,
  Portfolio,
  SeriesPoint,
  UserGoals,
  UserJournal,
  UserPlan,
} from "./types";

// ===== PORTFOLIOS: user has multiple, each with own holdings + constraints =====
export const PORTFOLIOS: Portfolio[] = [
  {
    id: "main",
    name: "Main",
    icon: "○",
    type: "free",
    typeLabel: "Free",
    color: "var(--accent)",
    notes: "Long-term core portfolio. No restrictions. This is where most of my money lives.",
    targetModelId: "bogle3",
    initialInvestment: 880000,
    totalValue: 1024280,
    asOf: "20 May 2026, 14:32 ICT",
    brokerage: "Demo Broker",
    perfPct: { d7: 1.1, d30: 3.2, ytd: 8.4, y1: 12.1 },
    series: [
      { d: "Nov 25", v: 880000 },
      { d: "Dec 25", v: 894720 },
      { d: "Jan 26", v: 876160 },
      { d: "Feb 26", v: 913600 },
      { d: "Mar 26", v: 944240 },
      { d: "Apr 26", v: 974880 },
      { d: "May 26", v: 1024280 },
    ],
    holdings: [
      {
        ticker: "SCBS&P500",
        thai: "เอสซีบี เอสแอนด์พี 500",
        name: "SCB S&P 500 Index Fund",
        category: "US Equity",
        class: "equity",
        region: "US",
        value: 365530,
        cost: 300000,
        units: 10623,
        nav: 34.4053,
        d1: 0.42,
        ytd: 11.2,
        y1: 14.8,
        ter: 0.4,
        color: "oklch(0.55 0.09 150)",
        source: "Demo Broker",
      },
      {
        ticker: "K-WORLDX",
        thai: "เค เวิลด์ เอ็กซ์",
        name: "Kasikorn World Equity Index",
        category: "Global Equity",
        class: "equity",
        region: "Global",
        value: 178200,
        cost: 160000,
        units: 14880,
        nav: 11.9748,
        d1: 0.18,
        ytd: 7.8,
        y1: 10.5,
        ter: 0.45,
        color: "oklch(0.55 0.10 230)",
        source: "Demo Broker",
      },
      {
        ticker: "K-FIXED",
        thai: "เค ตราสารหนี้",
        name: "Kasikorn Fixed Income",
        category: "Thai Fixed Income",
        class: "bond",
        region: "Thailand",
        value: 178420,
        cost: 170000,
        units: 14820,
        nav: 12.0388,
        d1: 0.04,
        ytd: 2.1,
        y1: 3.4,
        ter: 0.32,
        color: "oklch(0.55 0.07 200)",
        source: "Demo Broker",
      },
      {
        ticker: "K-USA-A",
        thai: "เค ยูเอสเอ เอ",
        name: "Kasikorn US Equity (A)",
        category: "US Equity (Active)",
        class: "equity",
        region: "US",
        value: 162800,
        cost: 140000,
        units: 8945,
        nav: 18.2008,
        d1: -0.31,
        ytd: 9.4,
        y1: 12.1,
        ter: 1.4,
        color: "oklch(0.55 0.11 70)",
        source: "Demo Broker",
      },
      {
        ticker: "KFGBRAND-A",
        thai: "เคเอฟ โกลบอลแบรนด์ เอ",
        name: "Krungsri Global Brands Equity",
        category: "Global Brands",
        class: "equity",
        region: "Global",
        value: 95800,
        cost: 90000,
        units: 5380,
        nav: 17.8094,
        d1: 0.62,
        ytd: 6.4,
        y1: 8.9,
        ter: 1.85,
        color: "oklch(0.55 0.10 300)",
        source: "Demo Broker",
      },
      {
        ticker: "KFCASH",
        thai: "เคเอฟ แคช",
        name: "Krungsri Cash Management",
        category: "Money Market",
        class: "cash",
        region: "Thailand",
        value: 43530,
        cost: 42000,
        units: 4236,
        nav: 10.2754,
        d1: 0.01,
        ytd: 0.8,
        y1: 1.5,
        ter: 0.18,
        color: "oklch(0.65 0.04 80)",
        source: "Demo Broker",
      },
    ],
  },
  {
    id: "ssf",
    name: "Tax-saving (SSF)",
    icon: "◇",
    type: "tax-locked",
    typeLabel: "Locked · 10yr",
    color: "oklch(0.55 0.10 230)",
    notes:
      "Super Savings Fund. Tax-deductible up to ฿200k/yr. Locked for 10 years. Can only switch within SSF universe.\nDo not touch until 2034.",
    targetModelId: "thaicore",
    initialInvestment: 180000,
    totalValue: 186940,
    asOf: "20 May 2026, 14:32 ICT",
    brokerage: "Demo Broker",
    perfPct: { d7: 0.4, d30: 1.1, ytd: 3.2, y1: 4.0 },
    series: [
      { d: "Nov 25", v: 180000 },
      { d: "Dec 25", v: 181400 },
      { d: "Jan 26", v: 179800 },
      { d: "Feb 26", v: 182300 },
      { d: "Mar 26", v: 184100 },
      { d: "Apr 26", v: 185600 },
      { d: "May 26", v: 186940 },
    ],
    holdings: [
      {
        ticker: "SCBSFF-SSF",
        thai: "เอสซีบี ตราสารหนี้ระยะสั้น เอสเอสเอฟ",
        name: "SCB Short-Term Fixed Income SSF",
        category: "Thai Fixed Income (SSF)",
        class: "bond",
        region: "Thailand",
        value: 96440,
        cost: 92000,
        units: 8520,
        nav: 11.32,
        d1: 0.02,
        ytd: 2.4,
        y1: 3.6,
        ter: 0.45,
        color: "oklch(0.55 0.07 200)",
        source: "Demo Broker",
      },
      {
        ticker: "K-USXNDQ-SSF",
        thai: "เค ยูเอส แนสแด็ก เอสเอสเอฟ",
        name: "Kasikorn US Nasdaq SSF",
        category: "US Equity (SSF)",
        class: "equity",
        region: "US",
        value: 64200,
        cost: 60000,
        units: 4810,
        nav: 13.35,
        d1: 0.58,
        ytd: 8.2,
        y1: 9.5,
        ter: 1.05,
        color: "oklch(0.55 0.09 150)",
        source: "Demo Broker",
      },
      {
        ticker: "K-WPSPX-SSF",
        thai: "เค โลก พลัส เอสเอสเอฟ",
        name: "Kasikorn Global Plus SSF",
        category: "Global Equity (SSF)",
        class: "equity",
        region: "Global",
        value: 26300,
        cost: 28000,
        units: 2160,
        nav: 12.18,
        d1: 0.21,
        ytd: 5.1,
        y1: 7.3,
        ter: 1.2,
        color: "oklch(0.55 0.10 230)",
        source: "Demo Broker",
      },
    ],
  },
  {
    id: "experiment",
    name: "Experiment",
    icon: "△",
    type: "experiment",
    typeLabel: "Sandbox",
    color: "oklch(0.55 0.10 50)",
    notes:
      "Small bucket for testing ideas. Not part of long-term plan.\nIdeas: tilt EM, small-cap, sector bets. Cap at ฿100k.",
    targetModelId: null,
    initialInvestment: 73530,
    totalValue: 73530,
    asOf: "20 May 2026, 14:32 ICT",
    brokerage: "Demo Broker",
    perfPct: { d7: 0.8, d30: 2.4, ytd: 4.2, y1: 6.1 },
    series: [
      { d: "Nov 25", v: 73530 },
      { d: "Dec 25", v: 74100 },
      { d: "Jan 26", v: 72800 },
      { d: "Feb 26", v: 74200 },
      { d: "Mar 26", v: 75100 },
      { d: "Apr 26", v: 73900 },
      { d: "May 26", v: 73530 },
    ],
    holdings: [
      {
        ticker: "ABSM",
        thai: "อเบอร์ดีน สมาร์ทแคปปิตอล",
        name: "Aberdeen Smart Capital (Thai Eq.)",
        category: "Thai Equity",
        class: "equity",
        region: "Thailand",
        value: 28560,
        cost: 32000,
        units: 2728,
        nav: 10.47,
        d1: -0.85,
        ytd: -4.2,
        y1: -1.8,
        ter: 1.95,
        color: "oklch(0.55 0.13 28)",
        source: "Demo Broker",
      },
      {
        ticker: "KKP-GINFRA",
        thai: "เคเคพี โกลบอลอินฟรา",
        name: "KKP Global Infrastructure",
        category: "Global Infrastructure",
        class: "alternative",
        region: "Global",
        value: 30970,
        cost: 28000,
        units: 2628,
        nav: 11.7853,
        d1: 0.21,
        ytd: 1.4,
        y1: 2.7,
        ter: 1.65,
        color: "oklch(0.55 0.10 110)",
        source: "Demo Broker",
      },
      {
        ticker: "TISCOEM",
        thai: "ทิสโก้ อีเอ็ม",
        name: "TISCO Emerging Markets",
        category: "EM Equity",
        class: "equity",
        region: "EM",
        value: 14000,
        cost: 13530,
        units: 1230,
        nav: 11.38,
        d1: 0.12,
        ytd: 3.2,
        y1: 5.4,
        ter: 1.55,
        color: "oklch(0.55 0.11 70)",
        source: "Demo Broker",
      },
    ],
  },
];

// ===== PORTFOLIO: the aggregate view (computed from PORTFOLIOS) =====
export const PORTFOLIO: AggregatePortfolio = (() => {
  const all = PORTFOLIOS;
  const allHoldings = all.flatMap((p) => p.holdings);
  const totalValue = all.reduce((s, p) => s + p.totalValue, 0);
  const initialInvestment = all.reduce((s, p) => s + p.initialInvestment, 0);
  const series: SeriesPoint[] = all[0].series.map((s, i) => ({
    d: s.d,
    v: all.reduce((sum, p) => sum + p.series[i].v, 0),
  }));
  const weighted = (key: keyof Portfolio["perfPct"]) =>
    all.reduce((sum, p) => sum + p.perfPct[key] * p.totalValue, 0) / totalValue;
  return {
    totalValue,
    baseCurrency: "THB",
    initialInvestment,
    perfPct: {
      d7: weighted("d7"),
      d30: weighted("d30"),
      ytd: weighted("ytd"),
      y1: weighted("y1"),
    },
    asOf: "20 May 2026, 14:32 ICT",
    brokerage: "Demo Broker",
    holdings: allHoldings,
    series,
    target: { equity: 70, bond: 20, alternative: 7, cash: 3 },
  };
})();

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

export const ANALYSIS: Analysis = {
  scores: {
    diversification: 72,
    risk: 58,
    fees: 81,
    alignment: 64,
  },
  riskTarget: 60,

  insights: [
    {
      type: "concentration",
      severity: "medium",
      title: "US equity is 46% of your book",
      body: "SCBS&P500 + K-USA-A = ฿591k. Above your target sleeve (35%). Three funds (SCBS&P500, K-USA-A, KFGBRAND-A) all hold MSFT, NVDA, AAPL, GOOGL — your true megacap-tech exposure is ~18%, not the 11% the labels suggest.",
    },
    {
      type: "drift",
      severity: "low",
      title: "Drift from target: 6.2 pp",
      body: "Equity at 79.5% vs 70% target. Bonds underweight by 6 pp. A small rebalance into K-FIXED would bring this in line.",
    },
    {
      type: "fees",
      severity: "good",
      title: "Blended TER of 0.61% — solid",
      body: "Your index-heavy mix keeps fees down. SCBS&P500 (0.40%) and K-WORLDX (0.45%) anchor this. KFGBRAND-A is your most expensive holding at 1.85%.",
    },
    {
      type: "weakness",
      severity: "medium",
      title: "ABSM has lagged 3 years running",
      body: "Aberdeen Smart Capital is -1.8% over 1y while SET is roughly flat. Consider whether the active premium is worth it vs a Thai index fund.",
    },
    {
      type: "strength",
      severity: "good",
      title: "Good behaviour during March drawdown",
      body: "You added ฿40k during the Feb–Mar dip rather than selling. That contributed ~1.4 pp to YTD returns.",
    },
  ],

  rebalance: [
    { ticker: "K-FIXED", from: 13.9, to: 20.0, dir: "buy", amount: 78320 },
    { ticker: "K-USA-A", from: 12.7, to: 9.0, dir: "sell", amount: 47500 },
    { ticker: "KFGBRAND-A", from: 11.1, to: 7.0, dir: "sell", amount: 52600 },
    { ticker: "KKP-GINFRA", from: 4.4, to: 5.5, dir: "buy", amount: 14100 },
    { ticker: "ABSM", from: 7.5, to: 6.0, dir: "sell", amount: 19200 },
  ],
};

export const AI_PERSONALITIES: Record<string, AIPersonality> = {
  advisor: {
    label: "Advisor",
    blurb: "Index-investing teacher · careful, cites reasoning",
    promptStyle: `You are Macrotide — a patient index-investing teacher and advisor. The user is a Thai retail investor learning about asset allocation. Your job:
- Explain concepts plainly (diversification, drift, rebalancing, expense ratios, dollar-cost averaging)
- Answer questions about THEIR portfolio specifically (you have the data)
- Be honest about uncertainty; this is not licensed financial advice
- Reference Thai mutual fund tickers (SCBS&P500, K-USA-A, K-WORLDX, K-FIXED, etc.) when relevant
- Use ฿ for THB amounts
- Encourage thinking long-term and ignoring noise
- Keep responses under 140 words, use short paragraphs and the occasional bullet`,
  },
};

// ===== Model Portfolios — for learning ideal allocations =====
export const MODEL_PORTFOLIOS: ModelPortfolio[] = [
  {
    id: "bogle3",
    name: "Bogleheads 3-Fund",
    tagline: "Index investing's most-recommended starting point",
    blurb:
      "John Bogle's philosophy distilled: own everything, hold forever, keep costs low. Three broad index funds across US, international, and bonds.",
    mix: [
      { label: "US Total Market", pct: 50, ticker: "SCBS&P500", color: "var(--accent)" },
      { label: "International Equity", pct: 30, ticker: "K-WORLDX", color: "#7C7CFF" },
      { label: "Thai Bonds", pct: 20, ticker: "K-FIXED", color: "#F4A434" },
    ],
    expectedReturn: 6.8,
    expectedVol: 11.5,
    ter: 0.45,
    horizon: "10+ yrs",
    risk: "balanced",
    pros: ["Lowest TER", "Easiest to maintain", "Beats 80% of active funds long-term"],
    cons: ["US-heavy", "No alternatives or commodities"],
  },
  {
    id: "allweather",
    name: "Ray Dalio All-Weather",
    tagline: "Built to survive any economic season",
    blurb:
      "Hedges across growth, recession, inflation and deflation. Lower volatility, more bonds and commodities. Ideal for the risk-averse.",
    mix: [
      { label: "Long-term Bonds", pct: 40, ticker: "K-FIXED", color: "#F4A434" },
      { label: "Mid-term Bonds", pct: 15, ticker: "K-FIXED", color: "#FFC97A" },
      { label: "Global Stocks", pct: 30, ticker: "K-WORLDX", color: "var(--accent)" },
      { label: "Gold", pct: 7.5, ticker: "TGOLD", color: "#D4AE5C" },
      { label: "Commodities", pct: 7.5, ticker: "KKP-GINFRA", color: "#7C7CFF" },
    ],
    expectedReturn: 5.4,
    expectedVol: 7.2,
    ter: 0.62,
    horizon: "Any",
    risk: "conservative",
    pros: ["Smooth ride", "Hedged against crises", "Lower drawdowns"],
    cons: ["Lower expected return", "Bond-heavy in low rates"],
  },
  {
    id: "thaicore",
    name: "Thai Conservative Income",
    tagline: "Home-biased, income-focused, lower volatility",
    blurb:
      "For investors who want to keep things close to home. Heavy on Thai fixed income with selective global equity for growth.",
    mix: [
      { label: "Thai Bonds", pct: 50, ticker: "K-FIXED", color: "#F4A434" },
      { label: "Thai Equity Dividend", pct: 25, ticker: "ABSM", color: "#D14545" },
      { label: "Global Equity", pct: 20, ticker: "K-WORLDX", color: "var(--accent)" },
      { label: "Cash", pct: 5, ticker: "KFCASH", color: "#9E9EA8" },
    ],
    expectedReturn: 4.6,
    expectedVol: 5.8,
    ter: 0.52,
    horizon: "3-7 yrs",
    risk: "conservative",
    pros: ["FX-stable", "Steady income", "Lower vol"],
    cons: ["Limited growth", "Home bias risk"],
  },
  {
    id: "growth80",
    name: "Growth Tilt 80/20",
    tagline: "For long horizons and stomach for volatility",
    blurb:
      "Aggressive equity tilt with global diversification. Accept bigger drawdowns in exchange for higher long-term return.",
    mix: [
      { label: "US Equity", pct: 40, ticker: "SCBS&P500", color: "var(--accent)" },
      { label: "Global Equity", pct: 25, ticker: "K-WORLDX", color: "#7C7CFF" },
      { label: "Global Brands", pct: 15, ticker: "KFGBRAND-A", color: "#C76A8F" },
      { label: "Thai Bonds", pct: 20, ticker: "K-FIXED", color: "#F4A434" },
    ],
    expectedReturn: 7.4,
    expectedVol: 13.8,
    ter: 0.71,
    horizon: "10+ yrs",
    risk: "growth",
    pros: ["Highest expected return", "Global diversification", "Compounds well long-term"],
    cons: ["Bigger drawdowns", "Concentration in US"],
  },
  {
    id: "permanent",
    name: "Permanent Portfolio",
    tagline: "Equal-weight across 4 asset classes — set and forget",
    blurb:
      "Harry Browne's classic. 25% each in stocks, bonds, gold, cash. Rebalance once a year. Boringly resilient.",
    mix: [
      { label: "Stocks", pct: 25, ticker: "K-WORLDX", color: "var(--accent)" },
      { label: "Long Bonds", pct: 25, ticker: "K-FIXED", color: "#F4A434" },
      { label: "Gold", pct: 25, ticker: "TGOLD", color: "#D4AE5C" },
      { label: "Cash", pct: 25, ticker: "KFCASH", color: "#9E9EA8" },
    ],
    expectedReturn: 4.8,
    expectedVol: 6.5,
    ter: 0.4,
    horizon: "Any",
    risk: "conservative",
    pros: ["Dead simple", "Resilient in every regime", "Cheapest"],
    cons: ["Lower return", "Gold drag in growth regimes"],
  },
  {
    id: "tdfu60",
    name: "Target-Date 2060 Glide",
    tagline: "Auto-adjusts risk as you age",
    blurb:
      "Aggressive equity now, glides toward bonds over decades. The 'set it and forget it' default in 401k plans worldwide.",
    mix: [
      { label: "US Equity", pct: 50, ticker: "SCBS&P500", color: "var(--accent)" },
      { label: "International", pct: 30, ticker: "K-WORLDX", color: "#7C7CFF" },
      { label: "Bonds (growing)", pct: 15, ticker: "K-FIXED", color: "#F4A434" },
      { label: "Cash", pct: 5, ticker: "KFCASH", color: "#9E9EA8" },
    ],
    expectedReturn: 7.0,
    expectedVol: 12.4,
    ter: 0.55,
    horizon: "30+ yrs",
    risk: "growth",
    pros: ["Auto-rebalances over time", "Age-appropriate risk", "Hands-off"],
    cons: ["Higher TER than 3-fund", "Less control"],
    source: "Vanguard methodology",
  },
  {
    id: "coffeehouse",
    name: "Coffeehouse Portfolio",
    tagline: "Bill Schultheis · 7 slices, calm rebalancing",
    blurb:
      "Seven equal-ish sleeves with a bond core. Tilts toward small-cap and value. Diversification without complexity.",
    mix: [
      { label: "US Large Cap", pct: 10, ticker: "SCBS&P500", color: "var(--accent)" },
      { label: "US Large Value", pct: 10, ticker: "K-USA-A", color: "oklch(0.55 0.10 200)" },
      { label: "US Small Cap", pct: 10, ticker: "K-USA-A", color: "#7C7CFF" },
      { label: "US Small Value", pct: 10, ticker: "K-USA-A", color: "#C76A8F" },
      { label: "International", pct: 10, ticker: "K-WORLDX", color: "#5BA7B5" },
      { label: "REITs", pct: 10, ticker: "KKP-GINFRA", color: "#F4A434" },
      { label: "Bonds", pct: 40, ticker: "K-FIXED", color: "oklch(0.55 0.07 200)" },
    ],
    expectedReturn: 6.2,
    expectedVol: 9.8,
    ter: 0.55,
    horizon: "Any",
    risk: "balanced",
    pros: ["Diversified across factors", "Lower volatility than 3-fund", "Easy to rebalance"],
    cons: ["Seven funds to manage", "Some overlap with smaller markets"],
    source: "coffeehouseinvestor.com",
  },
  {
    id: "golden_butterfly",
    name: "Golden Butterfly",
    tagline: "Tyler · Portfolio Charts · low drawdowns",
    blurb:
      "Equal weights across 5 sleeves designed to thrive in any economic regime. Strong historical drawdowns recovery.",
    mix: [
      { label: "US Stock", pct: 20, ticker: "SCBS&P500", color: "var(--accent)" },
      { label: "Small Cap Value", pct: 20, ticker: "K-USA-A", color: "#C76A8F" },
      { label: "Long Bonds", pct: 20, ticker: "K-FIXED", color: "oklch(0.55 0.07 200)" },
      { label: "Short Bonds", pct: 20, ticker: "K-FIXED", color: "#7C7CFF" },
      { label: "Gold", pct: 20, ticker: "TGOLD", color: "#D4AE5C" },
    ],
    expectedReturn: 5.6,
    expectedVol: 6.8,
    ter: 0.5,
    horizon: "Any",
    risk: "balanced",
    pros: ["Smooth across regimes", "Equal-weight simplicity", "Holds value in bear markets"],
    cons: ["Lower upside than equity-heavy", "Gold drag in growth years"],
    source: "portfoliocharts.com",
  },
  {
    id: "esg_tilt",
    name: "Global ESG Tilt",
    tagline: "Sustainable indices · climate-aware",
    blurb:
      "All-stock global tilt toward ESG-rated companies. For investors who want exposure to the broad market with a values screen.",
    mix: [
      { label: "Global ESG Eq.", pct: 70, ticker: "K-WORLDX", color: "oklch(0.55 0.13 150)" },
      { label: "EM ESG", pct: 15, ticker: "TISCOEM", color: "#7C7CFF" },
      { label: "Green Bonds", pct: 15, ticker: "K-FIXED", color: "#F4A434" },
    ],
    expectedReturn: 6.5,
    expectedVol: 13.1,
    ter: 0.82,
    horizon: "10+ yrs",
    risk: "growth",
    pros: ["Values-aligned", "Less fossil exposure", "Long-horizon growth"],
    cons: ["Higher TER than vanilla index", "Sector concentration in tech"],
    source: "MSCI ESG Leaders Index",
  },
  {
    id: "custom_thai_tilt",
    name: "My Thai Tilt",
    tagline: "Custom · added from chat",
    blurb:
      "Tilted toward Thai equity for home-currency stability. Conversation with the advisor on 18 May.",
    mix: [
      { label: "Thai Equity", pct: 40, ticker: "ABSM", color: "oklch(0.55 0.13 28)" },
      { label: "US Equity", pct: 30, ticker: "SCBS&P500", color: "var(--accent)" },
      { label: "Thai Bonds", pct: 25, ticker: "K-FIXED", color: "#F4A434" },
      { label: "Cash", pct: 5, ticker: "KFCASH", color: "#9E9EA8" },
    ],
    expectedReturn: 5.8,
    expectedVol: 9.2,
    ter: 0.62,
    horizon: "10+ yrs",
    risk: "balanced",
    pros: ["FX-stable", "Familiar holdings", "Mid-volatility"],
    cons: ["Higher home bias", "Lower diversification than global"],
    source: "Built from chat · 18 May 2026",
    isCustom: true,
  },
];

export const GEO_BREAKDOWN: Breakdown[] = [
  { label: "United States", pct: 48.3, color: "var(--accent)" },
  { label: "Thailand", pct: 32.1, color: "#F4A434" },
  { label: "Global ex-US/TH", pct: 14.6, color: "#7C7CFF" },
  { label: "Emerging Markets", pct: 5.0, color: "#C76A8F" },
];

export const SECTOR_BREAKDOWN: Breakdown[] = [
  { label: "Information Tech", pct: 26.8, color: "var(--accent)" },
  { label: "Financials", pct: 14.2, color: "#7C7CFF" },
  { label: "Government Bonds", pct: 13.9, color: "#F4A434" },
  { label: "Communication", pct: 9.4, color: "#C76A8F" },
  { label: "Consumer Disc.", pct: 8.6, color: "#5BA7B5" },
  { label: "Healthcare", pct: 7.2, color: "oklch(0.55 0.10 110)" },
  { label: "Industrials", pct: 6.8, color: "#A38A55" },
  { label: "Other", pct: 13.1, color: "#9E9EA8" },
];

export const DRIFT_SERIES: SeriesPoint[] = [
  { d: "Nov 25", v: 1.8 },
  { d: "Dec 25", v: 2.4 },
  { d: "Jan 26", v: 3.1 },
  { d: "Feb 26", v: 4.2 },
  { d: "Mar 26", v: 5.0 },
  { d: "Apr 26", v: 5.6 },
  { d: "May 26", v: 6.2 },
];

export const CONTRIB_SERIES: SeriesPoint[] = [
  { d: "Nov 25", v: 0 },
  { d: "Dec 25", v: 40000 },
  { d: "Jan 26", v: 0 },
  { d: "Feb 26", v: 30000 },
  { d: "Mar 26", v: 50000 },
  { d: "Apr 26", v: 0 },
  { d: "May 26", v: 25000 },
];

export const USER_JOURNAL: UserJournal = {
  notes: [
    {
      id: "n1",
      title: "Why rebalance matters",
      body: "Advisor: 'Rebalancing isn't about timing the market — it's about not letting any one asset class become a bet you didn't choose to make. Drift = invisible risk.'",
      source: "chat",
      date: "2 days ago",
      tags: ["rebalancing", "basics"],
    },
    {
      id: "n2",
      title: "My US tech exposure is real ~18%",
      body: "Three of my funds (SCBS&P500, K-USA-A, KFGBRAND-A) all hold MSFT/NVDA/AAPL/GOOGL. Surface allocation hides the true concentration.",
      source: "analysis",
      date: "2 days ago",
      tags: ["concentration"],
    },
    {
      id: "n3",
      title: "Dollar-cost averaging beats timing",
      body: "Decades of data: investors who DCA into index funds outperform those trying to time tops/bottoms. Boring works.",
      source: "chat",
      date: "5 days ago",
      tags: ["dca", "basics"],
    },
  ],
  plan: {
    target: "bogle3",
    monthlyContribution: 15000,
    nextRebalanceDate: "1 Jun 2026",
    commitments: [
      {
        text: "Rebalance toward Bogleheads 3-Fund by end of May",
        status: "in_progress",
        date: "18 May 2026",
      },
      {
        text: "Sell down KFGBRAND-A by ฿52k (high TER, overlap)",
        status: "in_progress",
        date: "18 May 2026",
      },
      {
        text: "Add ฿78k to K-FIXED to reach 20% bond sleeve",
        status: "in_progress",
        date: "18 May 2026",
      },
      { text: "Review portfolio in 90 days, not weekly", status: "ongoing", date: "10 May 2026" },
    ],
  },
  reading: [
    {
      id: "r1",
      title: "The Bogleheads' Guide to the Three-Fund Portfolio",
      source: "bogleheads.org",
      url: "https://bogleheads.org/wiki/Three-fund_portfolio",
      summary:
        "Classic primer: total US market + international + total bond. Why simplicity beats complexity for most investors.",
      readTime: 8,
      status: "read",
      savedDate: "5 days ago",
    },
    {
      id: "r2",
      title: "Why Low Fees Win Over Decades",
      source: "Morningstar",
      url: "#",
      summary:
        "A 1% fee difference compounds to ~25% less wealth over 30 years. The single biggest factor you actually control.",
      readTime: 6,
      status: "unread",
      savedDate: "3 days ago",
    },
    {
      id: "r3",
      title: "Ray Dalio on the All-Weather Portfolio",
      source: "Bridgewater",
      url: "#",
      summary: "Hedging across four economic regimes. Why it produces smoother rides.",
      readTime: 12,
      status: "in_progress",
      savedDate: "1 week ago",
    },
    {
      id: "r4",
      title: "SET Index vs Global Equities: A 20-Year Look",
      source: "Bangkok Post",
      url: "#",
      summary:
        "Why home-bias may be hurting Thai retail investors. Global diversification arguments tailored to Thailand.",
      readTime: 10,
      status: "unread",
      savedDate: "2 weeks ago",
    },
  ],
  feedback: [
    {
      id: "f1",
      topic: "Rebalance to All-Weather",
      rating: "down",
      note: "Too conservative for my horizon",
      date: "18 May 2026",
    },
    { id: "f2", topic: "Add monthly DCA to K-WORLDX", rating: "up", note: "", date: "16 May 2026" },
    {
      id: "f3",
      topic: "Reduce KFGBRAND-A exposure",
      rating: "up",
      note: "Agree, TER too high",
      date: "15 May 2026",
    },
    {
      id: "f4",
      topic: "Bogleheads 3-Fund as target",
      rating: "up",
      note: "Simple and proven",
      date: "12 May 2026",
    },
  ],
  savedModels: ["bogle3", "allweather"],
};

export const LEARN_CONTENT: LearnContent = {
  startHere: [
    {
      id: "l1",
      title: "What is index investing?",
      blurb:
        "The simplest, evidence-based way to build wealth. Why owning the whole market beats picking winners.",
      readTime: 5,
      tag: "BASICS",
    },
    {
      id: "l2",
      title: "Asset allocation 101",
      blurb: "Stocks, bonds, alternatives, cash — how to think about the mix that fits your goals.",
      readTime: 7,
      tag: "BASICS",
    },
    {
      id: "l3",
      title: "Why fees matter more than you think",
      blurb:
        "A 1% fee = 25% less wealth in 30 years. The most controllable factor in your returns.",
      readTime: 6,
      tag: "FEES",
    },
    {
      id: "l4",
      title: "How to rebalance — and how often",
      blurb: "Calendar vs threshold rebalancing. The case for boring discipline.",
      readTime: 8,
      tag: "REBALANCE",
    },
  ],
  topics: [
    { id: "t1", label: "Allocation", count: 12 },
    { id: "t2", label: "Rebalancing", count: 8 },
    { id: "t3", label: "Fees & taxes", count: 6 },
    { id: "t4", label: "Behaviour", count: 9 },
    { id: "t5", label: "Thai market", count: 5 },
    { id: "t6", label: "Global indices", count: 7 },
  ],
  recommendedForYou: [
    {
      id: "rl1",
      title: "Should you tilt toward US equity?",
      blurb: "Your portfolio is currently 46% US. Here's the case for and against.",
      readTime: 9,
      tag: "FOR YOU",
    },
    {
      id: "rl2",
      title: "Understanding fund overlap",
      blurb: "Three of your funds all hold the same top 10 companies. Why this matters.",
      readTime: 7,
      tag: "FOR YOU",
    },
    {
      id: "rl3",
      title: "When NOT to rebalance",
      blurb: "Sometimes drift is your friend. Tax drag, fee drag, and patience.",
      readTime: 6,
      tag: "FOR YOU",
    },
  ],
};

// ===== User Plan (free-form markdown brief, edited in place) =====
export const USER_PLAN: UserPlan = {
  markdown: `## Target
Bogleheads 3-Fund: 50% US equity (SCBS&P500), 30% International (K-WORLDX), 20% Thai Bonds (K-FIXED).
Open to advisor's suggestion if there's a better fit.

## Principles
- Low fees first — TER under 0.7% blended.
- Global diversification over home bias.
- Boring works. I don't want to think about this weekly.
- No active funds. Index only.

## Risk
Comfortable with 20% drawdowns. 30% would make me nervous but I won't sell.
I want a portfolio I can hold through anything.

## Commitments
- I will rebalance toward Bogleheads 3-Fund by end of May.
- I will sell down KFGBRAND-A (too expensive, overlaps).
- I will only review when drift > 7pp, not weekly.
- I won't buy individual stocks or crypto.

## Open questions
- Should I tilt more toward emerging markets?
- Is dollar-cost averaging worth it if my contributions are irregular?

## Contributions
No regular schedule — lump sums when I have extra cash.
Probably ~฿15-30k every few months.`,
  lastUpdated: "2 days ago",
  versions: [
    { date: "2 days ago", change: "Added 'No crypto' rule" },
    { date: "5 days ago", change: "Set target to Bogleheads 3-Fund" },
    { date: "1 week ago", change: "First draft" },
  ],
};

// ===== User goals / risk profile =====
export const USER_GOALS: UserGoals = {
  horizon: 15,
  risk: "balanced",
  monthlyContribution: 15000,
  targetReturn: 6.5,
  selectedModelId: "bogle3",
};

// ===== Benchmark series (for comparison overlay) =====
export const BENCHMARKS: Record<BenchmarkKey, SeriesPoint[]> = {
  sp500: [
    { d: "Nov 25", v: 100 },
    { d: "Dec 25", v: 101.2 },
    { d: "Jan 26", v: 99.8 },
    { d: "Feb 26", v: 102.4 },
    { d: "Mar 26", v: 104.8 },
    { d: "Apr 26", v: 108.1 },
    { d: "May 26", v: 111.2 },
  ],
  set: [
    { d: "Nov 25", v: 100 },
    { d: "Dec 25", v: 100.8 },
    { d: "Jan 26", v: 98.4 },
    { d: "Feb 26", v: 96.2 },
    { d: "Mar 26", v: 97.8 },
    { d: "Apr 26", v: 99.4 },
    { d: "May 26", v: 98.8 },
  ],
  m60_40: [
    { d: "Nov 25", v: 100 },
    { d: "Dec 25", v: 100.6 },
    { d: "Jan 26", v: 99.8 },
    { d: "Feb 26", v: 101.5 },
    { d: "Mar 26", v: 103.2 },
    { d: "Apr 26", v: 105.4 },
    { d: "May 26", v: 107.6 },
  ],
};

// ===== Plan markdown parsing helpers =====
export interface ParsedPlan {
  spine: {
    target: string | null;
    principles: string | null;
    risk: string | null;
    commitments: string | null;
  };
  extras: { title: string; body: string }[];
}

export function parsePlan(md: string | undefined): ParsedPlan {
  if (!md?.trim()) {
    return {
      spine: { target: null, principles: null, risk: null, commitments: null },
      extras: [],
    };
  }
  const sections: Record<string, string> = {};
  const lines = md.split("\n");
  let current: string | null = null;
  let buffer: string[] = [];
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)$/);
    if (m) {
      if (current) sections[current.toLowerCase()] = buffer.join("\n").trim();
      current = m[1].trim();
      buffer = [];
    } else if (current) {
      buffer.push(line);
    }
  }
  if (current) sections[current.toLowerCase()] = buffer.join("\n").trim();

  const findSection = (...keys: string[]) => {
    for (const k of keys) {
      const match = Object.keys(sections).find((s) => s.includes(k));
      if (match) return sections[match];
    }
    return null;
  };

  const spine = {
    target: findSection("target", "allocation"),
    principles: findSection("principles", "care about", "values"),
    risk: findSection("risk", "drawdown", "volatility"),
    commitments: findSection("commitment", "decided", "rules"),
  };

  const usedKeys = new Set<string>();
  for (const k of Object.keys(sections)) {
    if (
      k.includes("target") ||
      k.includes("allocation") ||
      k.includes("principles") ||
      k.includes("care about") ||
      k.includes("values") ||
      k.includes("risk") ||
      k.includes("drawdown") ||
      k.includes("volatility") ||
      k.includes("commitment") ||
      k.includes("decided") ||
      k.includes("rules")
    )
      usedKeys.add(k);
  }
  const extras: { title: string; body: string }[] = [];
  for (const k of Object.keys(sections)) {
    if (!usedKeys.has(k)) {
      extras.push({
        title: k.charAt(0).toUpperCase() + k.slice(1),
        body: sections[k],
      });
    }
  }
  return { spine, extras };
}

export function parseCommitments(text: string | null | undefined) {
  if (!text) return [] as { text: string; status: string; i: number }[];
  return text
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .map((t, i) => ({ text: t, status: "in_progress", i }));
}

export function parseBullets(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function parseQuestions(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter((l) => l.endsWith("?"));
}
