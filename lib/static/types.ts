// Shared types for the mock data layer

export type AssetClass = "equity" | "bond" | "alternative" | "cash";

export interface Holding {
  /** DB primary key — present on adapted holdings from /api/holdings. */
  id?: number;
  /** Which bucket the holding belongs to — present on adapted holdings. */
  bucketId?: string;
  ticker: string;
  thai?: string;
  name: string;
  category: string;
  class: AssetClass;
  region: string;
  value: number;
  cost: number;
  units: number;
  nav: number;
  d1: number;
  ytd: number;
  y1: number;
  ter: number;
  color: string;
  source: string;
  /** Data-routing key. Present on adapted holdings from /api/holdings. */
  quoteSource?: string;
}

export interface PerfPct {
  d7: number;
  d30: number;
  ytd: number;
  y1: number;
}

export interface SeriesPoint {
  d: string;
  v: number;
}

export type PortfolioType = "free" | "tax-locked" | "experiment";

export interface Portfolio {
  id: string;
  name: string;
  icon: string;
  type: PortfolioType;
  typeLabel: string;
  color: string;
  notes: string;
  targetModelId: string | null;
  initialInvestment: number;
  totalValue: number;
  asOf: string;
  brokerage: string;
  perfPct: PerfPct;
  series: SeriesPoint[];
  holdings: Holding[];
}

export interface AggregatePortfolio {
  totalValue: number;
  baseCurrency: string;
  initialInvestment: number;
  perfPct: PerfPct;
  asOf: string;
  brokerage: string;
  holdings: Holding[];
  series: SeriesPoint[];
  target: { equity: number; bond: number; alternative: number; cash: number };
}

export interface MarketIndex {
  sym: string;
  name: string;
  val: number;
  d: number;
  isYield?: boolean;
}

export interface NewsItem {
  tag: string;
  time: string;
  title: string;
  summary: string;
  impact: string;
  relevance: "high" | "medium" | "low";
}

export interface Markets {
  indices: MarketIndex[];
  news: NewsItem[];
  digest: string;
}

export type InsightSeverity = "good" | "low" | "medium" | "high";

export interface Insight {
  type: string;
  severity: InsightSeverity;
  title: string;
  body: string;
}

export interface RebalanceMove {
  ticker: string;
  from: number;
  to: number;
  dir: "buy" | "sell";
  amount: number;
}

export interface Analysis {
  scores: {
    diversification: number;
    risk: number;
    fees: number;
    alignment: number;
  };
  riskTarget: number;
  insights: Insight[];
  rebalance: RebalanceMove[];
}

export interface MixSlice {
  label: string;
  pct: number;
  ticker?: string;
  color: string;
}

export type RiskBand = "conservative" | "balanced" | "growth";

export interface ModelPortfolio {
  id: string;
  name: string;
  tagline: string;
  blurb: string;
  mix: MixSlice[];
  expectedReturn: number;
  expectedVol: number;
  ter: number;
  horizon: string;
  risk: RiskBand;
  pros: string[];
  cons: string[];
  source?: string;
  isCustom?: boolean;
}

export interface Breakdown {
  label: string;
  pct: number;
  color: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  source: string;
  date: string;
  tags: string[];
}

export interface Commitment {
  text: string;
  status: "in_progress" | "ongoing" | "done";
  date: string;
}

export interface JournalPlan {
  target: string;
  monthlyContribution: number;
  nextRebalanceDate: string;
  commitments: Commitment[];
}

export interface ReadingItem {
  id: string;
  title: string;
  source: string;
  url: string;
  summary: string;
  readTime: number;
  status: "read" | "unread" | "in_progress";
  savedDate: string;
}

export interface FeedbackItem {
  id: string;
  topic: string;
  rating: "up" | "down";
  note: string;
  date: string;
}

export interface UserJournal {
  notes: Note[];
  plan: JournalPlan;
  reading: ReadingItem[];
  feedback: FeedbackItem[];
  savedModels: string[];
}

export interface LearnArticle {
  id: string;
  title: string;
  blurb: string;
  readTime: number;
  tag: string;
}

export interface LearnTopic {
  id: string;
  label: string;
  count: number;
}

export interface LearnContent {
  startHere: LearnArticle[];
  topics: LearnTopic[];
  recommendedForYou: LearnArticle[];
}

export interface UserPlan {
  markdown: string;
  lastUpdated: string;
  versions: { date: string; change: string }[];
}

export interface UserGoals {
  horizon: number;
  risk: RiskBand;
  monthlyContribution: number;
  targetReturn: number;
  selectedModelId: string;
}

export interface AIPersonality {
  label: string;
  blurb: string;
  promptStyle: string;
}
