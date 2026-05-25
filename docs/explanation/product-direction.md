# Product direction

*Last updated: 2026-05-25*

Why Macrotide exists, who it's for, and how the pieces fit into one product.
This is the durable **why**; the forward build order lives in
[ROADMAP.md](../../ROADMAP.md) (Now / Next / Later) and what already works is the
[README status board](../../README.md#status). When intent and this page
disagree, this page is the product intent and the roadmap is how we get there.

## North star

> Help a Thai index investor **at least match — ideally beat — their index**,
> by making the whole journey one calm, transparent, **fee-aware** loop with an
> advisor that knows their actual portfolio.

"Beat" here is not stock-picking alpha. For an index investor the controllable
edges are narrow and real: **pay the lowest fee for the exposure you want**,
**stay on your target allocation** (don't drift, don't sit in cash drag), and
**don't talk yourself into off-plan bets**. Macrotide's job is to make those
edges easy to see and act on — and to teach *why* they're the edges. Returns are
won by behavior and cost, not by prediction; the product is built around that.

## Who it's for

**Primary — the DIY Thai index investor.** Has a fund-supermarket / brokerage
account, buys Thai mutual funds (including feeder funds for S&P 500 / global
exposure) and tax-advantaged wrappers (SSF / RMF / Thai ESG). Evidence-based,
fee-conscious, wants to run their own portfolio — but is quietly unsure whether
they're keeping up with their index or paying more in fees than they need to.
Not a trader; contributes on a cadence (often DCA) and rebalances rarely.

**Secondary — the curious beginner.** Wants to understand index investing before
committing real money. The demo mode and the Learn pillar are for them; the goal
is to graduate them into the primary persona.

**Not the audience:** active traders, options/leverage users, people wanting
stock tips or day-trading signals. The product will gently decline to serve
those jobs (see [Index-purist stance](#index-purist-stance)).

## The product is a four-stage loop

Every feature belongs to one of four pillars. Together they're the loop a
self-directed index investor actually walks, repeatedly:

### 1. Learn — *understand the game before you play it*

Evidence-based index-investing education, woven into the advisor rather than
parked in a separate reading silo: why owning the whole market beats picking
winners, why fees compound against you, how and when to rebalance, what the Thai
tax wrappers (SSF / RMF / Thai ESG) actually buy you. The advisor should be able
to teach in-context ("explain this number", "why does my fee matter?") and link
to short reads. Today this is stub content
([lib/static/learn.ts](../../lib/static/learn.ts)); making it real and
advisor-connected is the pillar's open work.

### 2. Analyze — *an honest mirror of your portfolio*

The portfolio view that tells you the truth: allocation by class/region, drift
from your target model, **blended (value-weighted) fee**, concentration, cash
drag, and performance **vs the index you're trying to match**. Honesty is the
differentiator — a deterministic 0–100 health score with a per-component
breakdown, real aligned benchmark series, and an explicit "unavailable" state
instead of fabricated numbers. This pillar is **mostly shipped** (see the
[README status board](../../README.md#status)); the advisor reads it through
`read_portfolio` / `read_performance` ([lib/advisor/tools.ts](../../lib/advisor/tools.ts)).

### 3. Research — *a market view for a long-term investor*

A grounded read of what's going on, framed for someone who holds for years, not
days: a plain-language daily digest anchored in *your* holdings, an AI-curated
news brief (clustered, "why it matters for a long-term index investor"), and
proactive nudges. Crucially, this pillar is where hot single-stock / thematic
questions land — and where the [index-purist stance](#index-purist-stance)
keeps the product honest. Today: a flat RSS feed; the synthesis is planned.

### 4. Select — *which funds you actually buy*

The pillar that closes the loop and the **biggest current gap**. Given a target
allocation, which *specific, low-fee* Thai-registered funds deliver it? This
needs a **fee-aware fund catalog** the app doesn't have yet (today, fees are
stored per-holding and user-supplied, not per-fund). Once the catalog exists,
the advisor and UI can answer "the lowest-fee S&P 500 feeder available to you",
flag fee creep against cheaper alternatives, let users explore and clone
**sample/model portfolios**, and turn a target into a concrete **DCA buy plan**.
Proposal cards (holdings, plan edits) already exist as the accept-only write
path ([lib/advisor/tools.ts](../../lib/advisor/tools.ts)).

## The example questions, mapped

The product is validated against the questions a real user brings. Each maps to
pillars and to specific capability — shipped or planned:

| Question | Pillars | How Macrotide answers |
| --- | --- | --- |
| *"Am I keeping up with / beating my index?"* | Analyze | `read_performance` + portfolio-vs-benchmark overlay over the same window. **Shipped.** |
| *"Should I buy more S&P 500 index fund?"* | Analyze → Select | Read drift & blended fee, then name the **lowest-fee** S&P 500 feeder available to a Thai investor and size the buy against the plan. *Analyze shipped; the fee-aware fund part needs the catalog.* |
| *"Should I buy SpaceX stock, and when?"* | Research → Learn | **Index-purist reframe**: explain why a single (here, private/unbuyable) name is an off-plan bet, then offer the closest low-fee thematic/broad index fund. *Planned — needs catalog categories + advisor framing.* |
| *"If I want this portfolio, which funds give me the lowest fee?"* | Select | **Fee-aware fund finder** over the SEC catalog — the flagship build. *The headline gap.* |
| *"Am I doing this right — what should I learn?"* | Learn | Advisor-connected education path. *Stub today.* |

## Index-purist stance

When a user asks about an individual stock or a hot theme ("should I buy
NVIDIA / SpaceX / this coin?"), Macrotide does **not** become a stock-research
tool. It treats the question as a teachable moment: explain why concentrated
single-name bets sit outside an index plan, what the user is really reaching for
(a sector? a growth theme? FOMO?), and offer the closest **low-fee index or
thematic fund** that captures that exposure within their allocation. This keeps
the product true to its north star and avoids the data, liability, and
maintenance burden of per-stock fundamentals.

The stance governs **advice**, not what you may **hold** — see core and
satellite below.

## What you can hold: asset classes and the core-satellite frame

An honest mirror has to show your *whole* portfolio. Macrotide describes any
holding along two independent axes: **what it is** (asset class) and **what role
it plays** (core or satellite).

**Asset classes.** Every holding lands in one of four classes (see
`propose_holding` in [lib/advisor/tools.ts](../../lib/advisor/tools.ts)) — the
standard allocation taxonomy, sufficient for an index portfolio:

- **`equity`** — stocks: index funds, ETFs, and individual shares.
- **`bond`** — fixed income: government and corporate bond funds.
- **`alternative`** — everything outside the stock/bond/cash trio: real estate
  (REITs), commodities (gold), and crypto. A catch-all for diversifiers and
  higher-volatility, non-traditional exposures.
- **`cash`** — cash and near-cash (deposits, money-market), which the health
  view watches for cash drag.

That's the whole taxonomy — there isn't a missing class to add; new instruments
(crypto included) slot into `alternative` rather than needing their own bucket.
Allocation, drift, and concentration are all computed over these four.

**Core vs satellite** is the *role*, orthogonal to class. **Core** is the broad,
low-fee index funds that are the heart of the portfolio and the focus of every
pillar — these span equity / bond / cash for diversification. **Satellite** is a
deliberately small sleeve for higher-conviction or speculative positions:
individual stocks, thematic or sector bets, and crypto. By role, these are
**satellite, not core** — you can hold and track them (the Yahoo provider
already prices individual equities and crypto pairs like `AAPL` / `BTC-USD`, so
no new data source is needed), but they're the small, optional edge around an
index core, not its foundation.

**A fund wrapper doesn't change the role — but index thinking still applies
inside the satellite.** Packaging a satellite bet into a fund (a sector ETF, a
broad thematic or crypto index fund) diversifies the *bet* but doesn't promote
it to core: the role tracks the asset's risk character, not its wrapper. What
*does* carry over is the index principle itself, fractally — for any satellite
appetite, a broad, low-fee fund beats hand-picking single names (a total-market
fund over stock-picking; a sector or thematic index fund over a single name).
So the advisor's move is always "prefer the diversified, low-fee fund over single
names, and keep the sleeve small."

**What the advisor does with the satellite.** It applies the same index-purist
discipline rather than becoming a stock/coin picker: it won't tell you to buy a
specific name or time the market, but it *will* keep you honest — surfacing the
satellite's size as a share of the whole, its concentration risk, and whether
it's drifting past the cap you set — and, when you ask "should I buy more of
this?", reframe to allocation and risk discipline (prefer broad, low-fee
exposure over single names; keep the satellite small) instead of a prediction.
The mirror stays honest; the advice stays index-first.

## What makes it different

- **Fee-awareness as a first-class lens.** Thai retail funds carry notoriously
  high fees; fee is the single most controllable factor in long-run return.
  Most tools bury it — Macrotide makes blended fee and cheaper-alternative
  surfacing a headline.
- **Honesty over polish.** Deterministic health scoring, real benchmark series,
  and "data unavailable" instead of fabricated numbers. The advisor references
  only figures its tools returned.
- **Thai-specific by design.** SEC Open API data, THB base currency, the
  feeder-fund reality, and the SSF / RMF / Thai ESG tax wrappers — not a US tool
  with Thailand bolted on.
- **An advisor that proposes, never trades.** Read-and-propose access to the
  user's real portfolio, plan, and journal; every write is an accept-only card.
- **Open-source, self-hostable, data-private.** Your financial data lives on
  your instance and is never sold or shared.

## How we'll know it's working

Personal-use / soft-public scale — so these are honest signal checks, not vanity
metrics:

- **Activation:** a new account imports ≥1 holding and has ≥1 advisor exchange.
- **Time-to-truth:** a user can answer "am I beating my index?" and "what's my
  blended fee?" in under a minute.
- **The fee outcome (headline):** blended TER drops after a user runs the fund
  finder — the clearest evidence the product delivered its core promise.
- **Return-to-check:** the user comes back (digest, portfolio glance) without
  being nudged by email.

## Non-goals

Carries the [ROADMAP out-of-scope list](../../ROADMAP.md#out-of-scope-until-a-real-need-appears),
plus these product-level lines:

- **No trade execution / brokerage sync** — Macrotide reads holdings you add; it
  never places orders.
- **No per-stock research, valuations, or trading signals** — you can *hold* and
  track individual stocks and crypto as a satellite; the advisor just won't pick
  them for you or predict their moves. See the index-purist stance.
- **No tax filing / advice** — it can explain how SSF/RMF/Thai ESG work; it is
  not a tax service.
- **No real-time trading-desk data** — long-horizon cadence, not tick data.

## References

- **Forward build order** → [ROADMAP.md](../../ROADMAP.md) (Now / Next / Later)
- **What works today** → [README status board](../../README.md#status)
- **What shipped** → [CHANGELOG.md](../../CHANGELOG.md)
- **Why we picked what we picked** → [decisions/](./decisions/)
- **Architecture** → [architecture.md](./architecture.md)
