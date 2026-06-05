# Feedback 01 — One calm scroll (kill the sub-tab)

> Lens: the minimalist who believes a tab is a wall between a person and their
> money. Reviewing spec 05 §2/§4's proposed `Holdings | Performance` sub-tab.

## 1. Verdict on the sub-tab — **KILL it**

The sub-tab is solving a real problem (don't overload Portfolio) with the wrong
instrument. A tab is a *mode switch*: it tells the user "your money lives in two
places, pick one." But spec 05's own thesis (§1) is that there is **one truth** —
holdings are a projection of one ledger. A `Holdings | Performance` toggle
re-commits the exact sin §1 just killed (the old Holdings↔Activity toggle): it
splits "what I hold" from "how it's doing" into two screens, when they are the
same question asked at two zoom levels. You'd be deleting one toggle and quietly
rebuilding it one level down.

Three concrete costs:

- **A click between the user and their headline number.** The single most
  important thing in the app — "how is my money doing?" — now lives behind a tab
  the user has to *discover and choose*. The default screen (Holdings) answers a
  weaker question (a list) and hides the better one.
- **It splits attention that wants to be unified.** Standings (per-fund) and the
  portfolio headline are the *same glance* in Design 01. The sub-tab tears them
  apart: per-fund on tab A, whole-portfolio on tab B.
- **Futureproofing is a fig leaf.** "Performance hosts #35/#36 later" reads like
  the tab earned its place — but #35/#36 are *different surfaces* (a what-if
  sandbox, a planner). When they're real, they want their *own* nav home, not a
  bunk in a sub-tab. Reserving a tab today for hypothetical tenants is exactly the
  premature structure minimalism rejects. Build the one screen people use daily;
  give backtest/planner a door when they exist.

The "if it outgrows the tab it graduates to a screen" escape hatch in §4 is the
tell: you're already planning to undo the tab. So don't build it.

**What I keep from 05:** everything settled — per-position drill-in
(`/portfolio/[ticker]`), the killed modal toggle, auto-detect import, the
`EventCard`, the event-card anatomy, the recording sheet. I'm only rejecting the
*sub-tab as the home for the portfolio-wide view*. That view is real and needed —
it just belongs **inline on one Portfolio page**, revealed by depth, not by a tab.

## 2. Proposed solution — one progressive-disclosure Portfolio page

One route, `/portfolio`. One vertical scroll. Three bands, top to bottom:
**Headline → Holdings → Activity.** Depth opens *in place*; it never navigates.

### DEFAULT (calm) state — the everyday glance

```
┌─ Portfolio ───────────────────────────────────────────────────────┐
│                                                       [ + Add ]    │
│                                                                    │
│   YOUR MONEY                                                       │
│   ฿1,284,500  invested                                            │  ← the one number, biggest type
│   ↑ ฿146,200 realized  ·  +9.4% IRR · money-weighted · 18 mo      │  ← one supporting line
│                                                                    │
│   ▸ Trends                                          ▸ All activity │  ← two quiet disclosure links
│  ──────────────────────────────────────────────────────────────  │
│                                                                    │
│   HOLDINGS                                                         │
│   ● EXAMPLE-FUND-A    ฿612,000   +12.1%   ▕▔▔▔▔▔▔▏ 48%          → │
│   ● K-EQUITY          ฿404,000    +6.8%   ▕▔▔▔▏    31%          → │
│   ● SCBSET            ฿268,000    −2.0%   ▕▔▔▏     21%          → │
│   ──────────────────────────────────────────────────────────────  │
│                                                                    │
│   RECENTLY                                                         │  ← banked tail, 3 cards only
│   ↑  Bought  EXAMPLE-FUND-A   12 Jun · 1,000 @ ฿50.00   ฿50,000   │
│   ↓  Sold    K-EQUITY          8 Jun · 600 @ ฿50.00     ฿30,000   │
│        ⤷ Realized +฿4,200 banked                                  │  ← the one flash of green
│   ◆  Dividend SCBSET           3 Jun · paid to cash     +฿1,150   │
│                              ▸ Show all 41                         │
└────────────────────────────────────────────────────────────────────┘
```

Nothing is hidden behind a tab. The headline answers "how's it going?" the instant
the screen loads. Below it, the two questions a holding screen has always
answered — *what do I hold* and *what did I just do* — sit right there, in a calm
tail of the three most-recent events. Charts and the full feed are folded away.

### EXPANDED (more-info) state — both disclosures open

```
┌─ Portfolio ───────────────────────────────────────────────────────┐
│                                                       [ + Add ]    │
│   YOUR MONEY                                                       │
│   ฿1,284,500  invested                                            │
│   ↑ ฿146,200 realized  ·  +9.4% IRR · money-weighted · 18 mo      │
│                                                                    │
│   ▾ Trends                                          ▾ All activity │  ← both now open
│   ┌ cost basis over time ───────┐  ┌ net invested / month ──────┐ │
│   │ ▁▂▃▄▅▆▇█  (Sparkline)       │  │ ▃▅▂▆▃▇  (Sparkline)        │ │
│   └─────────────────────────────┘  └────────────────────────────┘ │
│  ──────────────────────────────────────────────────────────────  │
│   HOLDINGS                                                         │
│   ● EXAMPLE-FUND-A    ฿612,000   +12.1%   ▕▔▔▔▔▔▔▏ 48%          → │
│   ● K-EQUITY          ฿404,000    +6.8%   ▕▔▔▔▏    31%          → │
│   ● SCBSET            ฿268,000    −2.0%   ▕▔▔▏     21%          → │
│  ──────────────────────────────────────────────────────────────  │
│   ALL ACTIVITY                              [ All funds ▾ ]        │  ← full month-grouped feed
│   JUNE 2026                                                        │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │ ↑ Bought EXAMPLE-FUND-A  12 Jun · 1,000 @ ฿50.00  ฿50,000 │    │
│   └──────────────────────────────────────────────────────────┘    │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │ ↓ Sold K-EQUITY  8 Jun · 600 @ ฿50.00          ฿30,000   │    │
│   │   ⤷ Realized +฿4,200 banked                              │    │
│   └──────────────────────────────────────────────────────────┘    │
│   ◆ Dividend SCBSET  3 Jun · paid to cash           +฿1,150       │
│   MAY 2026                                                         │
│   ⚑ Starting balance EXAMPLE-FUND-A  1 May · 10,000 u  ฿500,000   │  ← anchor, muted floor
│                              ▾ Collapse                            │
└────────────────────────────────────────────────────────────────────┘
```

Same page, same scroll position context. The user pulled depth toward themselves;
they did not leave "Holdings" to visit "Performance." When `All activity` is open
it grows the *same* `EventCard` feed spec 05 already designed — I'm just mounting
it inline instead of on a tab.

## 3. What I borrow from Design 01's main view

- **The headline number as the emotional through-line** — one bold figure
  (`฿1,284,500 invested`), one supporting line (`realized · IRR · duration`). This
  is Design 01 §4 verbatim, lifted to the *top of the Portfolio page* instead of a
  tab.
- **Standings → my HOLDINGS band.** Design 01's floating standings (per-fund
  weight bars, `→` drill-in) become the middle band, unchanged.
- **The card feed** — verb-first `EventCard`s, right-aligned mono amounts, the
  `⚑` anchor as the muted floor.
- **The banked tail** — `⤷ Realized +฿4,200 banked` as the *only* green accent in
  the stream, surfacing realized gain exactly where money was banked (Design 01
  §7). I keep this in both the calm "Recently" tail and the expanded feed.
- **Trends as a one-tap disclosure** — the two house `Sparkline`s, folded by
  default (Design 01 §7's "Trends expander"), not a permanent chart wall.

## 4. How I keep it non-overwhelming — the progressive-disclosure mechanics

1. **Calm by default, depth on demand.** The default screen shows exactly four
   things: headline, holdings, three recent events, two disclosure links. A new
   visitor parses it in one breath.
2. **Disclosures reveal *in place*; they never navigate.** `▸ Trends` and
   `▸ All activity` expand below their own affordance. No route change, no tab
   mode, no losing your place. Reading is additive, never a context swap.
3. **Two independent disclosures, not one mega-panel.** Trends and the full feed
   open separately, so the user pulls in *only* the depth they want. Wanting last
   month's dividends doesn't force a chart onto the screen.
4. **The "Recently" tail is the bridge.** Three cards prove the feed exists and
   show the latest action without committing the whole feed to the viewport — it's
   a teaser that makes `Show all 41` an obvious, low-cost expand.
5. **Per-fund depth lives one level down, where it belongs.** Heavy auditing of a
   single fund happens on its `/portfolio/[ticker]` page (settled, kept) — so the
   portfolio page never has to carry per-fund detail *and* whole-portfolio detail
   at once.

## 5. How #35 / #36 fit — without bloating the page

They do **not** live on this page, and they do **not** justify a tab now. Two clean
options, both better than a reserved sub-tab:

- **Their own nav home when they ship.** Backtest (a what-if sandbox) and the
  retirement/wealth planner are *distinct activities*, not a deeper read of today's
  ledger. They earn a real route (`/plan`, `/explore`, or a new "Outlook" nav item)
  when built. Nav is cheap; a confusing tab is not.
- **An entry point, not a container.** If you want them discoverable from
  Portfolio before they have a home, add a single quiet line at the very bottom of
  the scroll — *"Plan ahead → Backtest a mix · Wealth outlook"* — a doormat link
  that *navigates out* to the real surface. That reserves discoverability without
  reserving structure, and it disappears cleanly if the plan changes.

The principle: build the daily screen for the daily job. Don't pre-pour foundations
for tenants who haven't signed a lease — when they arrive, give them a front door,
not a shared room.

## 6. One honest tradeoff

**A single scroll makes the whole-portfolio activity feed less prominent than a
dedicated "Performance" home would.** On the sub-tab, "All activity" is a
first-class destination you can land on directly and deep-link to; in my design
it's a disclosure two bands down that you scroll-and-expand to reach. If the owner
believes reviewing the *full cross-fund history* is a frequent, deliberate
destination (not an occasional "let me check"), a tab gives it a sharper address
and a stable URL. I'm betting the opposite: that the everyday job is *the glance*
(headline + holdings + what-just-happened), that full-history review is rarer and
well-served by expand-in-place plus the per-fund pages, and that the cost of a
permanent mode-split on the app's most important screen outweighs the convenience
of a bookmarkable feed. If that bet is wrong, the feed — already a self-contained
`ActivityFeed` component — can graduate to its own route with zero rework. That's
the right direction to leave a door open: toward *less* structure now, not a tab
you're already planning to dissolve.
