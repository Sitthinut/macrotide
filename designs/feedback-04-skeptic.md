# Feedback 04 — The skeptic: kill the "Performance" sub-tab as a bundle

> Contrarian read on spec 05's open question. Settled items (per-position drill-in,
> killed Holdings/Activity modal toggle, auto-detect import, fixed backend) are taken
> as given and not relitigated. I'm only pressure-testing the **Performance sub-tab**.

## 1. Verdict — **MODIFY (mostly kill)**

The sub-tab is the right instinct (don't overload Holdings) executed as the wrong
object. Spec 05 names it "Performance" but its own §4 stacks **four unlike things**
under that name: a headline KPI, two trend sparklines, an all-activity feed, and two
reserved slots for backtest (#35) and a wealth planner (#36). That is not a
destination — it's a **junk drawer of "time-ish stuff."** The only thread connecting
them is "involves time somehow," which is not a user job.

The sharpest critique: **the all-activity feed is the weakest tenant and it's doing
the most work to justify the tab.** Once per-position drill-in is settled (it is), the
portfolio-wide reverse-chron feed is *near-redundant*. Ask what real job a 41-row "all
activity" stream serves that the position pages don't:

- "How did *this fund* get here?" → position page. Covered.
- "What did I do recently across everything?" → a recency glance, not a 41-row scroll.
- "Audit one mistyped fee across the whole book" → the feed is *worse* than the old
  grid at this (spec 01 admits as much in its honest tradeoff).
- "How's my money doing overall?" → that's the **headline KPI**, which is one block,
  not a feed.

So the feed earns maybe a *peek* (last 5 events), not a tab. And the headline KPI is
so cheap and so central it should never be one tap away — it should live where the
user already looks. Bundling a must-see headline with an optional feed with two
not-yet-built features means the headline pays the "extra tab" tax for its roommates.

Also: a two-item segmented control (`Holdings | Performance`) where one item is the
real screen and the other is a grab-bag invites the classic empty-second-tab smell.
New users with three holdings and twelve events will tap "Performance" once, see a tab
that's 60% reserved slots and a short feed, and never return.

## 2. The strongest alternative — **distribute, don't centralize**

Don't build a "Performance" place. Put each piece where its job already lives, and let
the **headline + a recent-activity peek ride on Holdings itself** (it's small, it's the
answer to "how am I doing," and Holdings is already the home users open by default).

Default Holdings tab — headline band on top, holdings list, recent peek at the bottom:

```
┌─ Portfolio ───────────────────────────────────────────────────────────────┐
│  Holdings                                                        [ + Add ]  │  ← NO second tab
│  ─────────────────────────────────────────────────────────────────────────│
│   ฿1,284,500 invested    ↑ ฿146,200 realized    +9.4% IRR · money-weighted │  ← the headline,
│                                                          ▸ Trends           │     always visible
│  ─────────────────────────────────────────────────────────────────────────│
│   ● EXAMPLE-FUND-A    ฿612,000   +12.1%   ▕▔▔▔▔▔▔▏ 48%                    → │
│   ● K-EQUITY          ฿404,000    +6.8%   ▕▔▔▔▏    31%                    → │
│   ● SCBSET            ฿268,000    −2.0%   ▕▔▔▏     21%                    → │
│  ─────────────────────────────────────────────────────────────────────────│
│   Recently                                          [ See all activity → ] │  ← peek, not a feed
│   ↑ Bought EXAMPLE-FUND-A   12 Jun                            ฿50,000       │
│   ↓ Sold   K-EQUITY          8 Jun       ⤷ +฿4,200 banked    ฿30,000       │
│   ◆ Dividend SCBSET          3 Jun                           +฿1,150       │
└─────────────────────────────────────────────────────────────────────────────┘
```

The headline is **one line**, not a block — it answers "how's my money?" the instant
Holdings opens, with zero navigation. `▸ Trends` is a quiet disclosure (the two
sparklines from spec 05 §4) for the rare "show me cost basis over time" moment.
"Recently" is a 3-row peek, the genuinely useful slice of an activity feed.

The full feed still exists, but as an **on-demand route, not a resident tab**:
`[ See all activity → ]` opens `/portfolio/activity` — a filterable full-history view
for the occasional "scan everything / find that one entry" job. It's a *tool you reach
for*, not real estate that's always mounted.

More-info / expanded (`▸ Trends` open + the on-demand full feed):

```
   ▾ Trends                                                                    
     ┌ cost basis over time ────────┐  ┌ net invested / month ───────────┐
     │ ▁▂▃▄▅▆▇█  (Sparkline)        │  │ ▃▅▂▆▃▇  (Sparkline)             │
     └──────────────────────────────┘  └─────────────────────────────────┘

   /portfolio/activity  (reached only via "See all activity →")
   ┌─ All activity ──────────────────────────────  [ All funds ▾ ] [ 2026 ▾ ]┐
   │  JUNE 2026                                                              │
   │  ↑ Bought EXAMPLE-FUND-A  12 Jun · 1,000 @ ฿50.00 · Broker X  ฿50,000  │
   │  ↓ Sold   K-EQUITY         8 Jun · 600 @ ฿50.00  ⤷+฿4,200    ฿30,000   │
   │  ◆ Dividend SCBSET         3 Jun · paid to cash              +฿1,150   │
   │  … 38 more                                                             │
   └────────────────────────────────────────────────────────────────────────┘
```

Net: **zero new sub-tabs**, the headline is *more* prominent than in spec 05 (always
on, not one tap away), Holdings stays uncluttered (one headline line + a 3-row peek is
less than spec 05's whole second tab), and the heavy feed is one click away for the
rare time it's wanted.

## 3. What I borrow from Design 01

The **event-card component and its grammar** — verb-first label, right-aligned mono
amount, the green "⤷ banked" tail on sells as the stream's only flash of color. That
card is genuinely good and is the reusable atom across position pages, the "Recently"
peek, and `/portfolio/activity`. I borrow the *card*, not 01's premise that the feed
should be the **main view**. 01 makes the feed the home of truth; I demote it to a peek
plus an on-demand tool, because the settled position pages already own "the story of a
fund," leaving the portfolio-wide feed without a primary job.

## 4. How I avoid overwhelm

By **distribution + progressive disclosure**, not a container:
- The must-see (headline) is always visible but compressed to one line.
- The often-useful (recent activity) is a 3-row peek with an escape hatch.
- The sometimes-useful (trends) is a one-tap disclosure.
- The rarely-needed (full filterable history) is a separate route you navigate to.

No screen ever shows all four at once. Spec 05's tab, by contrast, renders headline +
trends-affordance + feed + two reserved slots simultaneously — the overwhelm it set out
to avoid, recreated one level down.

## 5. Where #35 / #36 actually belong

They do **not** belong stapled under "Performance" — that's the bundle's original sin,
co-locating "log of what I did" with "simulate what I might do" purely because both
touch time.
- **#35 Backtest** is a *forward, hypothetical, exploratory* tool — "what if I'd held
  this mix." Its natural home is **Explore/Select**, alongside instrument discovery and
  "as-if" comparison. It reads the same `scope`-generic analytics 05 already designed;
  it just doesn't need to live next to your real ledger.
- **#36 Wealth/retirement planner** is a *goal-projection* surface — it belongs in the
  **Plan dock app** (the app already has a Plan dock and `/api/plan`). A retirement
  planner next to your transaction history is a category error; next to your goals and
  contributions plan, it's obvious.

Reserving two dotted slots for them was the main *architectural* argument for the tab.
Remove that argument (route them to Explore and Plan) and the tab loses its
future-proofing rationale, leaving only the near-redundant feed — which doesn't justify
a destination on its own.

## 6. Where my contrarian view is weakest

Honestly: three places.

1. **The cross-position recency glance is real.** "What did I do across everything
   lately?" is a legitimate job the per-position pages genuinely don't serve — you'd
   have to visit each fund. My "Recently" peek covers the *glance*, but if the owner's
   real behavior is monthly bulk reconciliation across all funds, a resident feed beats
   an on-demand route, and I'm underweighting that. If usage shows heavy all-activity
   use, spec 05's tab is vindicated.

2. **Distribution fragments the mental model.** Spec 05's "one place for the portfolio's
   trajectory" is *teachable* in a sentence; "headline on Holdings, history on a route,
   backtest in Explore, planner in Plan" is four sentences. A single Performance home is
   easier to explain and to find. I'm trading discoverability for cleanliness, and
   discoverability often wins with non-power users.

3. **#35/#36 routing is a forward bet on features that don't exist yet.** I'm confidently
   reassigning two unbuilt issues; if the backtest turns out to be "backtest *my actual
   portfolio's* trajectory" (not a hypothetical mix), it really does want to sit beside
   the real history, and the tab's reserved slot was right all along. My Explore/Plan
   routing assumes a shape #35/#36 haven't committed to.

**The honest synthesis:** if the owner wants ONE change, it's *rename and de-bundle* —
drop "Performance," lift the headline onto Holdings always-on, demote the feed to a peek
+ on-demand route, and stop reserving slots for features that belong elsewhere. Keep the
modular components (they're good and 05's build plan survives intact); kill the
*destination* that pretended four jobs were one.
