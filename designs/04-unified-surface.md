# 04 — One Truth

## 1. Name & one-line pitch

**One Truth** — a position and the history of how you got there are the *same object*, so you reach activity by opening a holding and drilling in, never by visiting a separate "Activity" feature.

## 2. The core idea

The current app splits one fact across two surfaces: Holdings (what you hold) and Activity (how you got it). That split is the bug. A holding is just the *running total* of its own events — so the events should live **inside** the holding, reached by expanding it, and "all activity" is simply the portfolio-level roll-up of every holding's ledger. I deliberately reject bolting "Activity" on as a second feature beside "Holdings," and I reject the dense-table-in-a-modal that flattens every fund's history into one undifferentiated scroll. There is one ledger; the UI should make holdings feel like a *view* of it, explored by zooming in (portfolio → position → events) and out.

## 3. Form factor & where it lives

A **real route**, not a modal: `/portfolio/[ticker]` is the position detail page; `/portfolio` is the roll-up. Activity is never its own destination — it is the lower half of every position page, and the portfolio page carries an **All activity** roll-up section beneath the holdings list. You reach a position by clicking its row in the Holdings list (the row you already stare at). Recording an event happens *in context*: the "+ Record" button on a position page pre-fills that position; the portfolio-level "+ Record" is the only place you pick which fund. Modals were wrong because a modal is a detour away from the thing — here the history *is* the thing, so it gets a URL, a back button, and deep-linkability.

## 4. The main view — position page (drill-in)

You clicked `EXAMPLE-FUND-A` in the Holdings list. This is the truth for that one position — projection on top, the ledger it's projected *from* below.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ‹ Portfolio                                          [ + Record ]   │
│                                                                       │
│  EXAMPLE-FUND-A                                    Global Equity Fund │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                       │
│   VALUE NOW          UNITS HELD        AVG COST       RETURN (IRR)    │
│   ฿182,400           1,240.5500        ฿129.42        +14.8%          │
│   ▲ ฿22,900 (+14.4%)                   money-weighted · since Jan '24 │
│                                                                       │
│   ┌───────────────── cost basis vs value over time ──────────────┐   │
│   │                                              ╱╲      ╱──────  │   │
│   │  value ───────────────────────────╱╲───────╱  ╲────╱         │   │
│   │  basis ·········· ___---‾‾‾‾___------‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾   │   │
│   └───────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  HOW YOU GOT HERE                              realized  +฿4,200      │
│  ─────────────────────────────────────────────────────────────────── │
│  2024                                                                 │
│   ┄ Starting balance   Jan 5   600.0000 u  @฿118.00     ฿70,800   ⌄  │
│   ● Buy                Mar 12  220.5000 u  @฿124.10     ฿27,365   ⌄  │
│   ● Buy                Aug 02  300.0000 u  @฿131.50     ฿39,450   ⌄  │
│   ◆ Dividend           Nov 20      —                    +฿1,180   ⌄  │
│  2025                                                                 │
│   ▼ Sell               Feb 18  180.0000 u  @฿142.00     ฿25,560      │
│        realized  +฿4,200 · cost ฿21,360                          ⌃  │
│        ┌───────────────────────────────────────────────────────┐    │
│        │ Date 2025-02-18  Units 180.0000  Price ฿142.00         │    │
│        │ Fee ฿0   Source SCB   Note "trimmed on rebalance"      │    │
│        │                              [ Delete ]   [ Save edit ] │    │
│        └───────────────────────────────────────────────────────┘    │
│   ● Buy                Apr 09  100.0000 u  @฿136.20     ฿13,620   ⌄  │
│                                                                       │
│  Average cost. Returns money-weighted, in THB. For information only.  │
└─────────────────────────────────────────────────────────────────────┘
```

The top block is the **projection**; the lower list is the **ledger it derives from**. The seam between them is the whole point — "how you got here" reads as the cause of the numbers above it. Events are grouped by year, newest activity nearest the running summary. Each row expands in place (`⌄`) to reveal full fields + edit; the Sell above is shown expanded. The starting balance carries a distinct `┄` glyph and muted tone — it's an anchor, not a trade.

## 5. Recording activity

`+ Record` from a position page opens an inline **composer docked to that position** — the fund is fixed, so the user only supplies the event. One tab strip covers all three intake modes; the staged rows are the same editable table whether typed, pasted, or OCR'd, and they land *into this position's* ledger.

```
┌──────── Record activity · EXAMPLE-FUND-A ──────────────────────────┐
│  ( Type a row )   ( Paste / CSV )   ( From screenshot )            │
│  ─────────────────────────────────────────────────────────────────│
│  Drop a broker screenshot or paste rows — we read them into the    │
│  table below for you to confirm. Nothing saves until you approve.  │
│                                                                    │
│  ┌── reading screenshot… 2 rows found ───────────────────────────┐ │
│  DATE        TYPE     UNITS      PRICE     FEE    AMOUNT          │ │
│  2025-05-14  Buy ▾    150.0000   ฿138.40   ฿0    ฿20,760    ✓     │ │
│  2025-06-01  Buy ▾    ⚠ units    ฿140.10   ฿0    ฿14,010    ⚠     │ │
│                                  └ add units, or we'll derive them │ │
│  ＋ add a row                                                       │ │
│  ──────────────────────────────────────────────────────────────── │ │
│  Source [ SCB ▾ ]                          2 ready   [ Save → ]    │ │
└────────────────────────────────────────────────────────────────────┘
```

**Setting a starting balance** is its own quiet path — offered when a position has no prior anchor, phrased as a question, never mixed into the trade-type dropdown:

```
┌── Start tracking EXAMPLE-FUND-A from a balance you already held ──┐
│  You held this before macrotide. Tell us the balance to anchor    │
│  every later buy and sell to.                                     │
│   As of [ 2024-01-05 ]   Units [ 600.0000 ]                       │
│   Avg cost (optional) [ ฿118.00 ]                                 │
│   Leave avg cost blank if unknown — gains stay hidden until set.  │
│                                       [ Set starting balance ]    │
└──────────────────────────────────────────────────────────────────┘
```

From the **portfolio roll-up**, `+ Record` is identical except a leading **fund** column lets one paste/screenshot fan out across many positions at once — the only place the fund isn't pre-bound. The portfolio importer is for the "here's my whole statement" case; the position composer is for "log this one trade." Same staged table, same confirm-before-save, two entry points matched to two intents.

## 6. Editing & deleting

Editing is the **expanded event row itself** — no separate mode, no jump. Click any row, it unfolds to show every field inline (the Sell in §4), edit, **Save edit**. Because holdings are a projection, saving an edit silently rebuilds the running summary above and bumps every downstream basis figure; the user sees the top block update — cause and effect on one screen.

Deleting an ordinary trade is immediate (with an undo toast). Deleting a **starting balance** re-bases every event after it, so it routes through a guard:

```
┌── Delete the starting balance for EXAMPLE-FUND-A? ───────────────┐
│  This anchor sits under 4 later events. Deleting it recomputes    │
│  units, average cost, and every gain in this position.            │
│                          [ Keep it ]   [ Delete and recompute ]   │
└───────────────────────────────────────────────────────────────────┘
```

## 7. How performance & realized gains surface

Performance lives **where the truth it measures lives** — never a separate analytics screen. **Per position**: the four-stat header (value, units, avg cost, IRR) is the projection; realized gain rides on the **HOW YOU GOT HERE** header and on each Sell row that produced it (so a gain sits next to the sell that banked it, not in an abstract total). Cost-basis-over-time is the one chart — value plotted *against* basis so the gap reads as gain.

**Portfolio roll-up** carries the same shape one level up: a header strip (total value, total invested, realized total, portfolio IRR) over the holdings list, then **All activity** below. IRR shows `—` with *"not enough history yet — about a month of activity needed"* when under ~28 days, so the absence is explained, never blank. No dashboard of orphaned metrics; every number is anchored to the position or portfolio it belongs to.

## 8. Empty & first-run state

A brand-new user has no ledger, so the portfolio page leads with the act of recording — framed as starting a position, not "adding a transaction":

```
┌──────────────────────────────────────────────────────────────┐
│              Your portfolio starts with one position.         │
│                                                                │
│   Add what you hold and how you got it — buys, sells, and a   │
│   starting balance for funds you held before tracking. Your   │
│   holdings, returns, and history all build from this.         │
│                                                                │
│     [ + Record your first position ]   [ Paste a statement ]  │
└──────────────────────────────────────────────────────────────┘
```

One concept ("a position and its history are one thing") is taught at the moment of first entry, so the mental model is right before any data exists.

## 9. Responsive / mobile

Mobile is where drill-in shines: portfolio list → tap a holding → full-screen position page → tap an event to expand. The composer becomes a bottom sheet; the staged table collapses each row to a labelled card (one field per line) so nothing needs sideways scrolling.

```
┌─────────────────────┐
│ EXAMPLE-FUND-A    × │
│ ─────────────────── │
│ Type   [ Buy    ▾ ] │
│ Date   [2025-05-14] │
│ Units  [ 150.0000 ] │
│ Price  [ ฿138.40  ] │
│ Amount [ ฿20,760  ] │
│ ─────────────────── │
│ ＋ add a row         │
│  1 ready  [ Save → ]│
└─────────────────────┘
```

## 10. Why this wins

- **The model becomes self-evident.** Seeing the running total *directly above* the events it's made of teaches "holdings are a projection of one ledger" without a word of explanation — a dense modal table can never show that because it severs the position from its summary.
- **Navigation matches the mental model.** Zoom in (portfolio → position → event) and out is one consistent gesture; there's no Holdings/Activity toggle to context-switch, and every record/edit happens in the place it belongs to.
- **Editing shows cause and effect.** Because the projection sits on the same screen as the ledger, an edit visibly moves the numbers it should move — corrections feel safe and legible instead of disappearing into a recompute you can't see.

**The honest tradeoff:** reviewing *everything at once* is one extra click away — a power user reconciling a 200-line annual statement across many funds gets the portfolio-level **All activity** roll-up, but the design optimizes for understanding one position deeply over scanning the whole flat ledger fast. I'm betting comprehension beats density for a calm, single-investor wealth dashboard.
