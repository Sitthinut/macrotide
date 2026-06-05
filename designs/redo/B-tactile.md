# B — Tactile consumer-fintech / delightful

> **Sensibility:** Designed like the best modern money apps — Copilot Money, Monarch,
> Robinhood done tastefully. Alive, friendly, mobile-first, with motion and direct
> manipulation. Money is legible and a little joyful: bold headline numbers, gestures,
> satisfying transitions. Recording feels as light as logging a coffee. Calm, but with
> warmth and life — never cold, never spreadsheet-y. **We reject data entry.**

The whole system rests on one conviction: a person's portfolio and the story of how they
built it are **the same object, seen at two zoom levels.** So the core interaction is
*zooming* — pinch out from "how's my money?" into a single fund, and the fund's history is
*already there underneath its number*, not behind a tab. Every event is a physical card you
can flick, tap-to-grow, and drop into the timeline. Nothing in this design is ever a grid of
cells in a dialog.

A note on warmth without coldness: the visual system stays the brief's calm editorial one
(`--paper` cards, hairlines, mono numbers, restrained color). "Tactile/delightful" lives in
**behavior** — spring physics, gesture, the headline number that counts up, the satisfying
*thunk* of a logged buy — not in loud color or chrome. Joy through motion, calm through type.

---

## 1. The single event — the **EventCard** (core atom)

Every buy, sell, dividend, fee, split, and anchor is the same physical primitive: a card with
a **left rail** (a 4px color stripe + a glyph in a soft tinted circle) that tells you *kind*
at a glance, before you read a word. The card has two sizes — **flicked-shut** (one line, used
in dense lists) and **opened** (tap to spring-expand into detail). Direct manipulation:
swipe-left reveals Edit / Delete; long-press to pick up and re-file the date.

**Flicked-shut (list density) — buy:**

```
┌─────────────────────────────────────────────────────────────┐
│ ▌●  Bought  EXAMPLE-FUND-A          120.0000 units    ฿12,400 │
│ ▌↑  ── ── ──                        ฿103.33 / unit     3 Jun  │
└─────────────────────────────────────────────────────────────┘
   └ green rail + up-arrow glyph = money went IN to the position
```

**Opened (tap to spring-grow) — sell, showing realized gain in context:**

```
┌─────────────────────────────────────────────────────────────┐
│ ▌●  Sold  EXAMPLE-FUND-B                              28 May  │
│ ▌↓  Global Equity Fund                                       │
│                                                              │
│        80.0000 units  ×  ฿151.20      ──────►   ฿12,096      │
│                                                              │
│   ┌───────────────────────────────────────────────────┐     │
│   │  Realized gain        + ฿1,840   (+17.9%)          │ ◄── banked here,
│   │  ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬                  │     not on a
│   └───────────────────────────────────────────────────┘     │     dashboard
│                                                              │
│   Cost out ฿10,256 · Fee ฿0 · via Broker statement · note — │
│                                                              │
│   ⟵ swipe for  ✎ Edit   ✕ Delete                            │
└─────────────────────────────────────────────────────────────┘
   └ red rail + down-arrow = money/units LEFT. The realized-gain chip
     is the loudest thing on a sell — it is *the point* of the event.
```

**Kind grammar (rail color · glyph · what the eye learns instantly):**

| Kind | Rail | Glyph | One-liner reads as |
|------|------|-------|--------------------|
| Buy | green | `↑` arrowUp | money in → units up |
| Sell | red | `↓` arrowDown | units out → **realized-gain chip** |
| Dividend | teal | `piggyBank` | cash income, often `+฿312` no units |
| Reinvest | teal | `refresh` | income looped back into units |
| Fee | amber | `pulse` | small negative, muted |
| Split | ink-soft | `pulse` | `2:1` ratio pill, ฿0 amount |
| **Starting balance** | accent + **lock chip** | `piggyBank` | "You held this before tracking" |
| **Restatement** | amber + **lock chip** | `pencil` | "We corrected the running balance" |

**Anchors look different on purpose.** They carry a tiny `🔒 anchor` pill (the only place the
`lock` icon appears in the ledger) and a faint dotted top-border, so they read as *load-bearing
foundations* rather than ordinary activity — and they sort to the bottom of their date as the
floor everything stands on.

```
┌─────────────────────────────────────────────────────────────┐
│ ▌●  Starting balance  EXAMPLE-FUND-C        🔒 anchor        │
│ ▌◆  500.0000 units · cost unknown                   1 Jan ’24 │
│      "Held before you started tracking."  Avg cost — · ⌃ open │
└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘
```

*Interaction:* spring-expand uses a 220ms `ease-out-back` so the card feels like it has a hinge.
The realized-gain chip animates a quick left-to-right fill on first appearance. Swipe actions
follow the finger 1:1 with rubber-band resistance past the action threshold.

---

## 2. The portfolio-wide history surface — **The Timeline**

A first-class screen (`chart`/`book` icon in the bottom nav, labeled **Activity**), not a
dialog. It is a single vertical **river of EventCards** grouped by month, with the river
*flowing through* a sticky **month spine** on the left. The dominant mental model: scroll = time
travel. Pull-to-refresh at top; infinite scroll into the past.

```
┌───────────────────────────────────────────────────────────┐
│  ‹ back        Activity                       ⌕   ⚲ filter │
│                                                            │
│   This month          + ฿24,496 in   ·   ฿12,096 out      │ ◄ month header
│   ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔        │   = net cash story
│                                                            │
│  ┌── JUN ──┐  ┌─────────────────────────────────────────┐ │
│  │   3     │  │ ▌↑ Bought EXAMPLE-FUND-A  120u    ฿12,400│ │
│  │         │  └─────────────────────────────────────────┘ │
│  │         │  ┌─────────────────────────────────────────┐ │
│  │         │  │ ▌⟳ Reinvest K-EQUITY  +4.1u       ฿312   │ │
│  └─────────┘  └─────────────────────────────────────────┘ │
│  ┌── MAY ──┐  ┌─────────────────────────────────────────┐ │
│  │  28     │  │ ▌↓ Sold EXAMPLE-FUND-B  80u  ฿12,096     │ │
│  │         │  │      ╰ +฿1,840 gain  ◄ inline chip       │ │
│  │         │  └─────────────────────────────────────────┘ │
│  │  12     │  │ ▌⊝ Fee  K-EQUITY                 −฿35     │ │
│  └─────────┘  └─────────────────────────────────────────┘ │
│                                                            │
│           ╴╴╴  scroll into 2024  ╴╴╴                       │
└───────────────────────────────────────────────────────────┘
        [ Home ]   [ Activity ]•   [ Advisor ]   [ You ]
                                            ╭───────╮
                                            │   +   │ ◄ floating Record FAB
                                            ╰───────╯
```

**Filter is a bottom sheet of toggle-chips, not a form.** Tapping `⚲ filter` slides up:

```
┌──────────────────  Filter  ──────────────────┐
│  Kinds   [Buys][Sells][Income][Fees][Anchors]│ ◄ chips toggle, multi-select
│  Fund    [ All ⌄ ]   When  [ All time ⌄ ]     │
│  ─────────────────────────────────────────── │
│            87 events · ฿412k moved            │ ◄ live count updates as you tap
│            [  Show results  ]                 │
└───────────────────────────────────────────────┘
```

Sort defaults to newest-first; a quiet segmented control (`Newest · Oldest · Biggest`) sits
under the search bar. Search is fuzzy over ticker + name + note. **Whole-portfolio ⇄ single-fund
is one tap:** every EventCard's ticker is a chip; tapping it filters the same river down to that
fund in place (a soft cross-fade, not a navigation), with a dismissible "Showing EXAMPLE-FUND-A
only ✕" pill at the top — so you never lose your scroll position or your sense of place.

---

## 3. Recording / importing — **the Record sheet**

The `+` FAB is everywhere (Home, Activity, single-fund). It opens **one** bottom sheet whose
first screen is deliberately not a form — it's a choice of *how you have the information*, each
phrased as a verb:

```
┌──────────────────  Record activity  ──────────────────┐
│                                                        │
│   ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  │
│   │  📷  Snap a   │  │  ⎘  Paste    │  │  ✎  Type    │  │
│   │   screenshot │  │   text/CSV   │  │   one entry │  │
│   └──────────────┘  └──────────────┘  └─────────────┘  │
│                                                        │
│   Most people snap their broker screen. We'll read it  │
│   and figure out what it is.                            │
└────────────────────────────────────────────────────────┘
```

### 3a. Snap / Paste → the **auto-detect moment** (the heart of the flow)

The user photographs whatever is on their broker screen — they are **never asked "is this
holdings or history?"** After OCR/parse, the classifier decides and we *tell them in plain
words*, with a one-tap correction. This is the single most important screen in the product, so
it gets a celebratory, confident moment — a quick `sparkle` and a count-up of what we found:

```
┌──────────────────────────────────────────────────────────┐
│  ✦  We read your screen                                   │
│                                                            │
│   This looks like  ┌───────────────────────────────────┐  │
│                    │  📸  what you hold right now        │  │ ◄ plain words,
│                    │      (your current positions)      │  │   no "snapshot"
│                    └───────────────────────────────────┘  │
│                                                            │
│   So we'll save these as  Starting balances — the funds   │
│   you already held before tracking began.                 │
│                                                            │
│              Not quite?  [ It's a buy/sell history → ]     │ ◄ one tap to flip
│                                                            │
│              ▼ 5 funds found · ฿487,200 total ▼            │
│   ────────────────────────────────────────────────────    │
│              [   Looks right — review   ]                  │
└────────────────────────────────────────────────────────────┘
```

Flipping it instantly re-narrates: *"Got it — we'll save these as activity (buys and sells over
time)."* The card art swaps (`📸 what you hold` ⇄ `🧾 what you did`) with a flip animation, so the
correction is legible and reversible. The classifier's guess is shown as a *belief we hold for
you*, never as a mode you were forced to choose.

### 3b. The editable confirmation — **the stack of cards**

Instead of a spreadsheet, the parsed rows are the same **EventCards** from §1, pre-filled, in a
reviewable stack. Anything the OCR was unsure about glows amber and is tappable. You fix in place;
no separate edit mode.

```
┌─────────────────────  Review 5 starting balances  ────────────────────┐
│   Tap anything to fix. Amber = please check.                          │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────┐        │
│  │ ▌◆ EXAMPLE-FUND-A   1,240.50 units   avg cost ฿98.20  ✓   │        │
│  └──────────────────────────────────────────────────────────┘        │
│  ┌──────────────────────────────────────────────────────────┐        │
│  │ ▌◆ EXAMPLE-FUND-C     500.00 units   ⚠ cost unknown  ⌄    │ ◄ amber │
│  └──────────────────────────────────────────────────────────┘        │
│  ┌──────────────────────────────────────────────────────────┐        │
│  │ ▌◆ K-EQUITY         88.1234 units   avg cost ฿412.00 ✓    │        │
│  └──────────────────────────────────────────────────────────┘        │
│                                                                       │
│   Held since  [ 1 Jan 2024 ⌄ ]   ← one date for the whole stack       │
│   ─────────────────────────────────────────────────────────────────  │
│            [  Add 5 starting balances  ]   ฿487,200                    │
└───────────────────────────────────────────────────────────────────────┘
```

On confirm: the sheet doesn't just close — the cards **fly up and out** one by one and you land
back on Home where the headline number **counts up** to its new total. Recording feels like a win.

### 3c. Type one entry — **a sentence, not a form**

Single manual entry rejects the labeled-field grid. It's a fill-in-the-blank sentence with tap
targets, so logging a buy reads like talking:

```
┌────────────────────  New entry  ────────────────────┐
│                                                      │
│   I   [ Bought ⌄ ]   [ EXAMPLE-FUND-A      ⌕ ]       │ ◄ kind + ticker
│                                                      │
│   [ 120 ] units  at  [ ฿103.33 ]  on  [ 3 Jun ⌄ ]    │
│                                                      │
│          ───────────────────────────                 │
│              Total          ฿12,400                  │ ◄ computes live, mono
│          ───────────────────────────                 │
│                                                      │
│   + fee   + note   + broker            [  Log it  ]  │ ◄ progressive: tap to add
└──────────────────────────────────────────────────────┘
```

Picking `Bought ⌄` morphs the sentence: choose **Dividend** and "units at ฿price" collapses to
"received ฿312"; choose **Split** and it becomes "[2] : [1] on [date]". One screen, many kinds,
no toggles, no empty fields you must fill. `[ Log it ]` gives a soft haptic *thunk* and a green
check that draws itself.

### 3d. Setting a Starting balance with cost unknown

Reached either from the import path (§3b) or `Type → Starting balance`. When cost is unknown we
**never block** — we make "I don't know" a first-class, dignified answer:

```
┌──────────────  Starting balance · EXAMPLE-FUND-C  ──────────────┐
│   You held this before you started tracking.                    │
│                                                                 │
│   How many units?     [ 500.0000        ]                       │
│                                                                 │
│   Do you know what you paid?                                    │
│     ( ) Yes — avg cost  [ ฿___ ]                                │
│     (•) Not sure  →  we'll value it from today and start your   │
│            return clock now. You can add the cost later.        │ ◄ honest tradeoff,
│                                                                 │   stated plainly
│   ─────────────────────────────────────────────────────────    │
│                       [  Set starting balance  ]                │
└─────────────────────────────────────────────────────────────────┘
```

Cost-unknown positions later wear a quiet `cost —` tag and a one-tap "Add cost basis" affordance
on their fund page, so the gap is visible and fixable, never silently wrong.

---

## 4. Editing & deleting — in place, with a guarded anchor

Editing is **the same EventCard, unlocked.** Swipe-left → `✎ Edit` flips the card to its
sentence form (§3c) pre-filled; saving re-flips it with a brief highlight pulse so you see what
changed. No modal, no new screen. Delete swipes the card off-screen to the right with an
**Undo** snackbar (5s) — reversible by default, because the ledger is precious.

```
   ⟵ swiping an ordinary EventCard:
┌───────────────────────────────────┬─────────┬─────────┐
│ ▌↑ Bought EXAMPLE-FUND-A   ฿12,400 │  ✎ Edit │ ✕ Delete│
└───────────────────────────────────┴─────────┴─────────┘
```

**The Starting-balance delete guard** is the one place we deliberately add friction, because
deleting an anchor recomputes everything downstream. It is not a generic "Are you sure?" — it
*shows the blast radius* and makes you type to confirm:

```
┌────────────────  Delete a starting balance?  ────────────────┐
│   🔒  EXAMPLE-FUND-C · 500 units                              │
│                                                               │
│   This is a foundation. Removing it rebuilds everything       │
│   that came after it:                                         │
│                                                               │
│     • 4 later events for this fund will be recalculated       │
│     • Your return and cost basis for it will change           │
│     • Total invested drops by ฿49,100                         │ ◄ concrete impact
│                                                               │
│   Type  DELETE  to confirm   [ ________ ]                     │
│                                                               │
│        [ Keep it ]              [ Delete & rebuild ]          │ ◄ destructive = red,
└───────────────────────────────────────────────────────────────┘   only enabled on match
```

A Restatement delete gets a lighter version of the same guard (it also moves the running balance,
but affects fewer rows). Ordinary buys/sells/dividends get only the Undo snackbar — friction is
proportional to blast radius.

---

## 5. The Portfolio home — **"how's my money?" before any row**

The home opens with one enormous mono number and almost nothing else. The headline answers the
question before you read; everything beneath is *teasers that pull you deeper*. The hero number
**counts up** on load and on every new record — the app's signature delight.

```
┌───────────────────────────────────────────────────────────┐
│  Good evening.                                      ⚙       │
│                                                            │
│       Your money                                           │
│                                                            │
│        ฿1,284,500                                          │ ◄ huge mono, counts up
│        ▲ ฿18,400  (+1.45%)  today                          │   green/red by sign
│                                                            │
│     ╭─────────────────────────────────────────────────╮   │
│     │      ╱╲          ╱╲╱╲                      ╱     │   │ ◄ area sparkline,
│     │  ╱╲╱   ╲╱╲    ╱╲╱     ╲      ╱╲          ╱╲╱      │   │   1M·3M·1Y·All
│     │ ╱        ╰╴╴╴╴        ╰╴╴╴╴╱   ╰╴╴╴╴╴╴╴╴╱         │   │   draws in on load
│     ╰─────────────────────────────────────────────────╯   │
│       1M   3M   1Y   All                                   │
│                                                            │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐         │
│   │ Invested    │ │ Return      │ │ Banked      │         │ ◄ 3 stat tiles,
│   │ ฿1,012,000  │ │ +14.2% IRR  │ │ +฿41,300    │         │   tap → §3 analytics
│   └─────────────┘ └─────────────┘ └─────────────┘         │
│                                                            │
│   Your funds                                    See all ›  │
│   ┌─────────────────────────────────────────────────────┐ │
│   │ EXAMPLE-FUND-A   ฿412,800   ▲ +12.4%        ▁▂▃▅▇    │ │ ◄ tap a fund →
│   │ K-EQUITY         ฿388,100   ▼  −2.1%        ▇▅▃▂▁    │ │   single-fund page
│   │ SCBSET           ฿221,400   ▲  +6.8%        ▂▃▄▅▆    │ │   (the "zoom in")
│   └─────────────────────────────────────────────────────┘ │
│                                                            │
│   Recent                                        Activity › │
│   ▌↑ Bought EXAMPLE-FUND-A · 3 Jun            ฿12,400      │ ◄ last 3 EventCards
│   ▌↓ Sold EXAMPLE-FUND-B · 28 May    +฿1,840  ฿12,096      │   tease the Timeline
└───────────────────────────────────────────────────────────┘
       [ Home ]•  [ Activity ]   [ Advisor ]   [ You ]    +
```

The three stat tiles put **performance in context**: Banked (realized gain) lives next to the
money, and tapping any tile expands it inline into the relevant analytic — never an orphaned
dashboard. "See all ›" → fund list; tapping a fund → the single-position page (the zoom-in);
"Activity ›" or "Recent" → the Timeline.

---

## 6. The single-position page — summary above the history that made it

This is the design's thesis made literal: **the fund's headline number and the history that
produced it are one continuous scroll.** Top = where you are; scroll down = how you got here. The
cost-basis-vs-value chart sits between them as the bridge.

```
┌───────────────────────────────────────────────────────────┐
│  ‹ Home          EXAMPLE-FUND-A                    ⋯        │
│                  Asia Growth Fund                          │
│                                                            │
│        ฿412,800                                            │ ◄ this fund's value
│        1,240.50 units  ·  avg cost ฿98.20                  │
│        ▲ +฿51,200  (+14.2%)  all time                      │
│                                                            │
│     ╭─────────────────────────────────────────────────╮   │
│     │                                      ╱╲    value ●│   │ ◄ TWO lines:
│     │                              ╱╲╱╲╱╲╱╲  ╲          │   │   value (solid)
│     │            ╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱           ╲╱        │   │   vs cost basis
│     │ ────────────────────────────────────────  basis ○│   │   (dotted, stepped)
│     │═══════╪══════╪═══════╪════════╪═══════╪═══════════│   │   gap = unrealized
│     ╰─────────────────────────────────────────────────╯   │
│        the green fill between the lines = your gain        │
│                                                            │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐                  │
│   │ Return   │ │ Income   │ │ Banked   │                  │ ◄ per-fund analytics
│   │ +14.2%   │ │ +฿1,240  │ │ +฿0      │                  │   scoped to THIS fund
│   └──────────┘ └──────────┘ └──────────┘                  │
│                                                            │
│   ─────────────  How you got here  ─────────────          │ ◄ the seam: summary
│                                                            │   above, history below
│  ┌── JUN ──┐  ┌─────────────────────────────────────────┐ │
│  │   3     │  │ ▌↑ Bought  120u × ฿103.33       ฿12,400  │ │
│  └─────────┘  └─────────────────────────────────────────┘ │
│  ┌── MAR ──┐  ┌─────────────────────────────────────────┐ │
│  │  14     │  │ ▌⟳ Reinvest  +4.1u               ฿312    │ │
│  └─────────┘  └─────────────────────────────────────────┘ │
│  ┌── ’24 ──┐  ┌─────────────────────────────────────────┐ │
│  │  1 Jan  │  │ ▌◆ Starting balance  1,116u  🔒 anchor   │ │ ◄ the foundation,
│  └┄┄┄┄┄┄┄┄┄┘  └┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘ │   at the bottom
│                                       + Record for this   │
└───────────────────────────────────────────────────────────┘
```

It's the **same Timeline component** from §2, pre-filtered to this fund — so navigating
whole-portfolio ⇄ single-fund is conceptually free. Tapping the chart's legend toggles
value/basis lines; pinching the chart zooms its time window. The `+ Record for this` button opens
the §3 Record sheet pre-scoped to the fund.

---

## 7. Every state

**Empty / first-run** — warm, single call to action, no empty grid:

```
┌───────────────────────────────────────────────┐
│              piggyBank ●                       │
│        Let's see your money.                   │
│                                                │
│   Snap a photo of your broker screen and       │
│   we'll do the rest — no typing, no setup.     │
│                                                │
│           [  📷  Snap your portfolio  ]        │
│              or  paste · type it in            │
└───────────────────────────────────────────────┘
```

**Loading** — the hero number shimmers as a skeleton block of the right width; sparkline draws
left-to-right as a ghost; cards are soft pulsing bars. Never a spinner on the whole screen.

**Cost-unknown** — value shows, but the Return tile reads `—` with a tappable line: *"Add what
you paid for EXAMPLE-FUND-C to see its return."* The position card wears a small `cost —` tag.

**Return-not-available-yet (<~28 days)** — never a bare dash. The Return tile shows:

```
┌──────────────────────────┐
│ Return                   │
│   Soon                   │
│ Needs ~4 more weeks of   │ ◄ human reason, the
│ activity to be reliable. │   brief's explicit rule
└──────────────────────────┘
```

**Price-unavailable** — the value renders as `฿— · price unavailable` in muted ink with a quiet
`↻ retry`; the unit count still shows (we know units even when we don't know today's NAV), and
the fund still sorts/lives normally. We never hide a position just because a quote failed.

**Error** (parse/import or save failure) — recoverable and friendly, with the user's input
preserved:

```
┌───────────────────────────────────────────────┐
│  ⚠  We couldn't read that one.                 │
│  The photo was a little blurry on 2 rows.      │
│                                                │
│  [ Retake photo ]   [ Type them in instead ]   │ ◄ never a dead end;
│                      your other 3 rows are safe.│   keeps partial work
└───────────────────────────────────────────────┘
```

---

## Component inventory

- **EventCard** — the atom (§1). Two densities (flicked-shut / opened), per-kind rail+glyph
  grammar, swipe-to-Edit/Delete, the **RealizedGainChip** as a sub-element, anchor/lock
  treatment. Every list of events anywhere is a column of these.
- **Timeline** — month-spine river of EventCards (§2). Reused verbatim, scoped, as the lower half
  of the single-fund page. Owns grouping, sort segment, and the in-place fund-filter pill.
- **HeroNumber** — the count-up mono headline + delta line + period sparkline. Used for total
  money (Home) and per-fund value (fund page).
- **StatTile** — small tappable tile (Invested / Return / Banked / Income) that expands inline
  into its analytic. Carries the not-available-yet and cost-unknown copy states.
- **DualLineChart** — the value-vs-basis SVG with the green gain-fill between lines; legend
  toggles, pinch-zoom window.
- **RecordSheet** — the bottom-sheet host (§3) with its verb-choice entry, the **DetectCard**
  (the flip-to-correct auto-detect moment), the **CardStackReview** (editable confirmation), and
  the **SentenceForm** (fill-in-the-blank single entry).
- **GuardDialog** — blast-radius + type-to-confirm destructive dialog (§4), scaled by impact.
- **ChipBar / FilterSheet** — toggle-chips for kinds/fund/time with a live result count.
- **UndoSnackbar** — the default safety net for any delete.
- **EmptyState / Skeleton / RetryInline** — the calm system states (§7).

## Motion & transition feel

Motion is the entire personality — it's how this stays "tactile/delightful" while the palette
stays calm. Everything springs rather than fades: cards expand on a 220ms `ease-out-back` hinge,
the Record sheet rises with a slight overshoot and settles, confirmed entries physically **fly
into** the Timeline and the HeroNumber **counts up** to absorb them (the signature moment — money
recorded should feel *earned*, not filed). Gestures track the finger 1:1 with rubber-band
resistance at thresholds; deletes slide off with an Undo net. Zooming Home → fund → event is one
continuous spatial idea: the fund's number grows out of its Home row, its history unfolds beneath
it, an event blooms open in place — you always feel *where you are in the same object*. Haptics
are sparing and meaningful: a soft *thunk* on a logged entry, a firmer one when an anchor's guard
unlocks. Nothing blocks; nothing spins. The result is an app where recording your investing
history feels less like bookkeeping and more like watching your money come into focus.
