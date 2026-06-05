# Money Story — a living feed of what your money did

## 1. Name & one-line pitch

**Money Story.** A beautiful, scannable reverse-chronological feed of friendly event cards — one calm headline number up top — that turns "my buy/sell history" into a story you actually want to read.

## 2. The core idea

A transaction ledger is not a spreadsheet; it is a **timeline of decisions you made about your money**. So I render it as a *feed* — rich, tappable cards in reverse-chronological order, each one a small human-readable sentence ("You bought EXAMPLE-FUND-A") — with a single bold headline that answers "how's it going?" before any row is read. I **deliberately reject the grid**: no eight-column data table, no Holdings/Activity toggle, no modal-over-modal. Holdings and history are the *same* truth, so I show holdings as the **standings** that float above the same feed — tap a holding, the feed filters to that fund. Recording activity should feel as light as logging a coffee in a budgeting app, not like filing a tax return.

## 3. Form factor & where it lives

A **real first-class route: `/activity`** ("Money Story" in the nav, `book` icon), promoted out of the Portfolio-header modal entirely. The conceptual problem — that holdings are a projection of one ledger — is *unsolvable inside a modal*, because a modal frames Activity as a sub-task of Holdings. Giving the ledger its own screen makes it the home of truth; the Portfolio screen's holdings become tap-throughs *into* this feed. Recording happens in a **bottom sheet** (mobile) / right-docked **compose drawer** (desktop) launched by one persistent **`+` button** — never a full modal takeover, so the feed stays visible behind it as living context.

## 4. The main view — ASCII mockup

```
┌─────────────────────────────────────────────────────────────┐
│  Money Story                                      [ + Add ]   │
│  ───────────────────────────────────────────────────────────│
│                                                              │
│   YOUR MONEY, ALL IN                                         │
│   ฿1,284,500  invested                                       │
│   ↑ ฿146,200 realized  ·  +9.4% IRR · money-weighted        │
│   ▁▂▃▄▅▆▇█  contributions over 18 months                     │
│                                                              │
│  ── Standings ──────────────────────  [ All ▾ ]  filter ─────│
│   ● EXAMPLE-FUND-A   ฿612k   +12.1%   ▕▔▔▔▔▔▔▏ 48%           │
│   ● K-EQUITY         ฿404k    +6.8%   ▕▔▔▔▏    31%           │
│   ● SCBSET           ฿268k    −2.0%   ▕▔▔▏     21%           │
│   ───────── tap a fund to filter the story below ───────    │
│                                                              │
│  ══ This month · June 2026 ════════════════════════════════ │
│                                                              │
│   ┌────────────────────────────────────────────────────┐    │
│   │  ↑  Bought  EXAMPLE-FUND-A           ฿50,000        │    │
│   │     12 Jun · 1,000 units @ ฿50.00 · Broker X        │    │
│   └────────────────────────────────────────────────────┘    │
│   ┌────────────────────────────────────────────────────┐    │
│   │  ↓  Sold  K-EQUITY                   ฿30,000        │    │
│   │     08 Jun · 600 units @ ฿50.00                     │    │
│   │     ⤷  Realized  + ฿4,200   banked                  │    │
│   └────────────────────────────────────────────────────┘    │
│   ┌────────────────────────────────────────────────────┐    │
│   │  ◆  Dividend  SCBSET                 + ฿1,150       │    │
│   │     03 Jun · paid to cash                           │    │
│   └────────────────────────────────────────────────────┘    │
│                                                              │
│  ══ May 2026 ══════════════════════════════════════════════ │
│                                                              │
│   ┌────────────────────────────────────────────────────┐    │
│   │  ⚑  Starting balance  EXAMPLE-FUND-A   ฿500,000     │    │
│   │     01 May · 10,000 units · avg cost ฿50.00         │    │
│   │     where your story begins                         │    │
│   └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

The headline is the emotional through-line: **one number** (invested), one supporting line (realized + IRR), one sparkline. Each card is a sentence — verb-first, fund-named, amount right-aligned in mono. Color is restrained: an `arrowUp` accent ring for buys, a muted `arrowDown` for sells, a teal `◆` for income, an `amber ⚑` for the anchor. The sell card *grows a small "Realized" tail* because that's the one moment money was actually banked — the feed's only flash of green. No row affordances on screen; tapping a card opens it.

## 5. Recording activity — ASCII mockup

One `+` opens a **compose sheet** that defaults to the lightest path (a single friendly event) and reveals bulk/OCR as needed — recording feels like adding a transaction in Copilot, not filling a grid.

```
┌──────────── Add to your story ────────────────┐
│  ( • One event )  ( Paste many )  ( Photo )    │  ← segmented
│ ─────────────────────────────────────────────│
│                                               │
│   What happened?                              │
│   [ ↑ Bought ][ ↓ Sold ][ ◆ Dividend ][ … ]   │  ← big chips
│                                               │
│   Fund                                        │
│   [ EXAMPLE-FUND-A          ⌄ ]  · YOURS      │  ← autocomplete
│                                               │
│   ┌─────────────┐  ┌─────────────┐            │
│   │ Amount  ฿   │  │ Date        │            │
│   │ 50,000      │  │ 12 Jun 2026 │            │
│   └─────────────┘  └─────────────┘            │
│   Units 1,000   ·   Price ฿50.00   (auto ⟳)   │  ← derived, editable
│                                               │
│   Broker X ⌄                         optional │
│                                               │
│         [ Add to story  ✓ ]                   │
└───────────────────────────────────────────────┘
```

**Paste many / Photo** swap the body, not the chrome. They drop you into a **confirmation feed** — the same cards as the main view, but in *draft* state, so you confirm what you'll see, not abstract rows:

```
┌──────────── Confirm 3 events ─────────────────┐
│  Read from your screenshot. Tap any to fix.   │
│                                               │
│   ✓ ↑ Bought EXAMPLE-FUND-A   ฿50,000  12 Jun │
│   ⚠ ↓ Sold   K-EQUITY         ฿—      08 Jun  │  ← amber: needs amount
│   ✓ ◆ Dividend SCBSET         ฿1,150  03 Jun  │
│                                               │
│   2 ready · 1 needs a number                  │
│            [ Add 2 to story  ✓ ]              │
└───────────────────────────────────────────────┘
```

**Starting balance** is not a transaction type in the chip row (it isn't something that "happened"). It lives behind a quiet link — *"Already held this before tracking? Set a starting balance"* — opening a focused card: fund, units held, avg cost (with *"Leave blank if unknown — gains stay hidden until you add it"*). It saves as a `⚑ Starting balance` anchor card, visually distinct, always the floor of the feed.

## 6. Editing & deleting

Tap any card → it **flips in place** into an inline editor (same card footprint, fields revealed), with `Save` / a small `pencil`-to-`Delete`. No separate edit modal. This is the budgeting-app gesture: tap the thing, change the thing.

The **starting-balance delete guard**: deleting a `⚑` anchor recomputes every downstream position, so its card's delete routes through an in-app confirm (never native `confirm()`):

```
┌── Delete this starting point? ──────────────┐
│  Your EXAMPLE-FUND-A story is built on this  │
│  ฿500,000 starting balance. Removing it      │
│  recalculates everything that came after.    │
│         [ Keep ]      [ Delete anyway ]      │
└──────────────────────────────────────────────┘
```

Ordinary buys/sells delete on a single confirm-tap with an **Undo** snackbar — low-stakes, reversible, feels alive.

## 7. How performance & realized gains surface

Performance is **woven into the story, not bolted on as a stats grid**:

- **IRR + invested** are the headline (§4) — one number you see first, one supporting line. IRR shows its caption *"money-weighted"*; if under ~28 days of activity it reads *"Return appears once you've held about a month"* instead of a blank dash, so the absence is explained.
- **Realized gain** surfaces *in context* — as the green tail on each sell card (the moment it was banked), and summed in the headline's *"↑ ฿146,200 realized"*. You never hunt for it; it appears exactly where the banking happened.
- **Cost basis over time** and **net invested by month** live in a **"Trends" expander** under the headline — one tap reveals two house-style sparklines (the existing `Sparkline`), folded away by default so the feed stays calm. Per-fund, the same trends scope to the filtered fund.

The discipline: the feed carries the *narrative*, the headline carries the *one truth*, and the analytics hide one tap deep so the screen never reads as a dashboard.

## 8. Empty & first-run state

```
┌─────────────────────────────────────────────┐
│              ✦  Start your money story        │
│                                              │
│   Every buy, sell, and dividend becomes a    │
│   card here — with your realized gains and   │
│   money-weighted return along the way.       │
│                                              │
│        [ + Add your first event ]            │
│        [ Paste a log ]  [ Use a photo ]      │
│                                              │
│   Already investing? Set a starting balance  │
│   for what you held before today.            │
└─────────────────────────────────────────────┘
```

Warm, single-focus, one primary action. No empty grid skeleton — an invitation, not a form.

## 9. Responsive / mobile

Mobile-first by construction: the feed *is* a vertical scroll of cards, which is already the native mobile shape — the desktop view is just the same column centered with the Standings rail beside it. The headline collapses to one number + one line; Standings becomes a horizontal chip-scroll. The `+` is a thumb-reachable FAB; compose is a bottom sheet.

```
┌───────────────┐
│ ฿1.28M in     │
│ +9.4% · ฿146k │
│───────────────│
│ ↑ EXAMPLE-A   │
│ ฿50,000 12Jun │
│───────────────│
│ ↓ K-EQUITY    │
│ ฿30,000 ·+4.2k│
│───────────────│
│        ( + )  │ ← FAB
└───────────────┘
```

## 10. Why this wins

- **Legible at a glance.** One headline number answers "how's my money doing?" before a single row is read; a dense table answers nothing until you parse it. The feed is scannable on a phone in the time a grid takes to load.
- **Holdings and history feel like one truth.** Standings float above the *same* feed and filter it on tap — the projection-of-one-ledger concept becomes physical, not a Holdings/Activity toggle that implies two features.
- **Recording feels light.** A budgeting-app compose sheet (chips, one fund, one amount) and a *draft-feed* confirmation make logging — even bulk OCR — feel like adding a transaction, not filing a return.

**The honest tradeoff:** a feed is gorgeous for tens-to-hundreds of events but **less efficient for power audit** — eyeballing 400 rows for a single mistyped fee, or scanning every column at once, is genuinely faster in a spreadsheet. I bet that a personal investor reviewing *their own* decisions wants the story far more often than the audit, and I push the rare audit need into per-fund filtering + the Trends expander rather than letting it shape the everyday surface.
```
