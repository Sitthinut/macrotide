# Feedback 02 — Information architecture review of the Performance sub-tab

> Reviewing spec 05 §2/§4: a `Holdings | Performance` sub-tab on the Portfolio
> screen hosting the portfolio-wide headline + Trends + all-activity feed, and
> reserved as the futureproof home for **#35 backtest** and **#36 retirement/
> wealth planner**. Settled and not relitigated: per-position drill-in pages,
> the killed Holdings↔Activity modal toggle, import auto-detect, the fixed
> backend.

## 1. Verdict on the sub-tab — **MODIFY (keep two views, change the framing)**

The sub-tab is the right *shape* for **today's** content and the wrong *container*
for **tomorrow's**. Keep a two-view Portfolio. But:

1. **Don't ship it as `Holdings | Performance`.** That label pair quietly
   re-creates pain #1 — it reads as "two features", the same trap the killed
   toggle set. Holdings is a *what-I-own* snapshot; the time-trajectory view is a
   *how-it's-going* read. Name them for the questions they answer, not for the
   data type behind them.
2. **Make the trajectory view the DEFAULT, with Holdings one tap away** (option b),
   because the owner's stated want — "easy to read, info on demand, not
   overwhelming" — is the *headline-first* hierarchy from Design 01, and a list of
   rows is the worse first read.
3. **Do not let #35/#36 live inside this tab.** Spec 05 §4 reserves dotted slots
   for them *under the activity feed*. That is the one genuinely wrong call here
   (see §5). They are planning/simulation tools, not activity history — putting
   them at the bottom of a transactions feed buries two whole product areas under
   scrolling.

So: keep the two-view Portfolio, flip the default, rename the tabs, and evict
#35/#36 to the `APPS_RAIL` ("Plan" already exists there). That preserves
everything good in 05 and fixes the two IA smells.

## 2. Options compared

The mobile nav is **already at its 5-item ceiling** (`MOBILE_NAV` in `App.tsx`:
Portfolio · Markets · Explore · Advisor · Journal). That hard constraint kills (c)
on its own.

| Option | Pros | Cons |
| --- | --- | --- |
| **(a) `Holdings \| Performance` sub-tabs**, Holdings default (spec 05) | Zero nav cost; familiar; per-position pages unaffected | "Two features" framing echoes the killed toggle; the *answer* ("how's it going?") is one tab away from the default; #35/#36 cram into a feed |
| **(b) Trajectory DEFAULT, Holdings nested** *(recommend)* | Headline-first matches owner's "easy to read"; the question users actually open Portfolio to ask is answered on arrival; Holdings is a fast, obvious second tap | Slightly unconventional (most apps default to a holdings list); needs good empty/first-run handling so a new user isn't shown an empty trajectory |
| **(c) New top-level "Performance"/"Journey" screen** | Clean home for the trajectory + room to grow | **Blocked: no mobile nav slot.** Splits the "one truth" across two screens — reintroduces the disconnect the redesign exists to remove |
| **(d) "Overview/Home" default summarizing everything**, Holdings & Performance as deeper views | Great glanceable home | Three levels where two suffice; Overview + Performance overlap so much they'd duplicate the headline; over-built for one investor's data volume |
| **(e — recommend) (b) + #35/#36 to `APPS_RAIL`** | Best of (b); planning tools get a real home next to "Plan"; Portfolio stays about *what happened*, the rail is about *what could happen* | Backtest loses adjacency to the holdings it simulates — solved with a deep link (§5) |

**Recommendation: (e).** Default Portfolio to the trajectory view, nest Holdings,
rename both tabs, and route #35/#36 to the existing `APPS_RAIL` rather than the
activity feed.

## 3. Recommended structure

**Tabs renamed:** `Summary | Holdings`. "Summary" leads (default) and answers
"how's my money doing?"; "Holdings" is the positions list. Same two-view skeleton
as 05, flipped order + honest labels — no new component cost.

```
/portfolio                 Summary (default) | Holdings        ← segmented tabs
/portfolio/[ticker]        position page: running total + its ledger  (settled, unchanged)
```

**DEFAULT — Summary tab** (headline → trends on demand → recent activity):

```
┌─ Portfolio ──────────────────────────────────────────────────────────────┐
│  [ Summary ]   Holdings                                          [ + Add ] │
│  ──────────────────────────────────────────────────────────────────────── │
│   ฿1,284,500 invested                                                      │  ← the one read
│   ↑ ฿146,200 realized   ·   +9.4% IRR · money-weighted   ·   over 18 mo    │
│                                                                            │
│   ▸ Trends                                          (cost basis · invested)│  ← disclosure, folded
│                                                                            │
│   ── Recent activity ─────────────────────────────────────────────────── │
│   ┌──────────────────────────────────────────────────────────────────┐    │
│   │  ↑  Bought  EXAMPLE-FUND-A                          ฿50,000       │    │
│   │     12 Jun · 1,000 units @ ฿50.00 · Broker X                     │    │
│   └──────────────────────────────────────────────────────────────────┘    │
│   ┌──────────────────────────────────────────────────────────────────┐    │
│   │  ↓  Sold  K-EQUITY        8 Jun · 600 @ ฿50.00      ฿30,000       │    │
│   │     ⤷ Realized +฿4,200 banked                                    │    │
│   └──────────────────────────────────────────────────────────────────┘    │
│   ◆  Dividend  SCBSET   3 Jun · paid to cash             +฿1,150           │
│                          [ Show all 41 → ]                                 │
└────────────────────────────────────────────────────────────────────────────┘
```

**SECOND TAP — Holdings tab** (today's list; each row → its position page):

```
┌─ Portfolio ──────────────────────────────────────────────────────────────┐
│  Summary   [ Holdings ]                                          [ + Add ] │
│  ──────────────────────────────────────────────────────────────────────── │
│  ● EXAMPLE-FUND-A      ฿612,000   +12.1%   ▕▔▔▔▔▔▔▏ 48%                   → │
│  ● K-EQUITY            ฿404,000    +6.8%   ▕▔▔▔▏    31%                   → │
│  ● SCBSET              ฿268,000    −2.0%   ▕▔▔▏     21%                   → │
└────────────────────────────────────────────────────────────────────────────┘
```

**DRILL-IN (settled, shown for completeness)** — `/portfolio/[ticker]`: running
total on top, its own ledger below. Reached from a Holdings row *or* by tapping a
fund name in any Summary card. Backtest/Outlook deep-link **into** this page
scoped to the fund (§5).

`+ Add` is the single contextual entry from any of these (auto-detect, no toggle).

## 4. What I borrow from Design 01's main view

- **The one-headline hierarchy** as the literal first thing on the default tab —
  one bold number (`฿1,284,500 invested`), one supporting line (realized · IRR ·
  span). This is the whole reason to make Summary the default: Design 01 proved
  the answer should precede the rows.
- **Verb-first event cards** (`↑ Bought`, `↓ Sold`, `◆ Dividend`) with the
  right-aligned mono amount — reused verbatim as the `EventCard` component across
  Summary, position pages, and the import confirm draft.
- **The green "Realized … banked" tail** on sell cards as the *only* green accent
  in the stream — realized gain surfaces where it happened, not in a stats grid.
- **The Trends disclosure** — folded by default, one tap reveals the two
  house-style `Sparkline`s. This is exactly the owner's "more info on demand";
  borrow it as-is.
- **Standings-style holdings** — Design 01 floats holdings as tappable "standings"
  above the same feed. I split that into the Holdings tab rather than stacking it,
  to keep the default Summary calm — but the *tap-a-fund-to-drill-in* behavior is
  borrowed straight through.

I deliberately do **not** borrow Design 01's single-screen "everything in one
scroll." For an investor whose holdings list and trajectory feed both grow, two
named views beat one long scroll.

## 5. How #35 / #36 slot in — the scaling story

**They do not belong with activity history.** Activity is a *record of what
happened*; backtest and planner are *simulations of what could happen*. Different
axis, different mental mode, different cadence (you read activity weekly; you run a
backtest occasionally). Spec 05's reserved slots at the bottom of the feed would
make a user scroll past 41 transactions to reach a retirement planner — and would
make the Summary tab a junk drawer the moment both land.

**Where they go:** the wide shell already has an `APPS_RAIL`
(Advisor · Portfolios · **Plan** · Notes). #36 retirement/wealth planner *is*
"Plan" — it extends the existing rail item, costing **zero** new nav. #35 backtest
joins the rail (or nests under Plan as "Plan: project · backtest"). On mobile,
where there's no rail and no nav slot, both reach via a **"Plan & simulate" entry
in the Portfolio overflow / Summary footer**, not as feed sections.

**Keeping the adjacency 05 wanted:** the reason 05 co-located them with the
portfolio was so a backtest could reuse the user's real holdings. Preserve that
with **deep links, not co-location** — a "Backtest this mix" affordance on the
Summary headline and a "Backtest this fund" link on each position page open the
rail tool **pre-seeded with that scope**. The `ActivityFeed`/headline already read
a generic `scope` (per 05's build plan), so a backtest "as-if" series reuses the
same components without living in the same container.

**Net:** Portfolio stays the home of *truth* (what happened, derived holdings);
the rail becomes the home of *projection* (what could happen). That boundary
scales cleanly — #35/#36 land as rail tools, the Summary tab never bloats, and
nothing graduates to a contested new top-level screen.

## 6. One honest tradeoff

**Defaulting to Summary over Holdings is mildly unconventional and slightly worse
for the "just let me see my positions" power-user moment.** Every brokerage app
opens on a holdings list, so muscle memory expects rows first; a user who opens
Portfolio fifteen times a day only to scan position values now eats one extra tap
every time. I take that bet because the owner explicitly asked for *easy to read,
not overwhelming* — and the headline-first read serves the everyday "how's it
going?" question better than a list serves it — but it is a real cost paid by the
exact power-user the list format favors. Mitigation: the Summary→Holdings tap is
one cheap, sticky, obvious move, and `Show all →` plus per-fund drill-in keep the
full audit one level deep for when the list-scanner needs it.
