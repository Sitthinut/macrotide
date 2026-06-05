# Direction 03 — The Ledger Story

## 1. Name & one-line pitch

**The Ledger Story** — your investing history read as a vertical timeline: chapters by year, entries woven with quiet context, so you *feel* the arc of how this portfolio was built while still being able to fix any line.

## 2. The core idea

A portfolio's history is not a database you query — it is a **story told over time**, and the most truthful way to show it is the same way you'd read a private-bank statement you actually cared about: top to bottom, period by period, with the numbers given room to breathe. I reject the spreadsheet entirely — the dense grid, the column headers, the holdings-vs-activity toggle. There is one truth (the ledger) and holdings are just *where the story has gotten to so far*, so the position lives at the top of its own thread as a standing summary, and every buy, sell, and dividend below it is a chapter in how you arrived there.

## 3. Form factor & where it lives

A **real full-page route: `/journal/history`** (a sibling tab inside the existing Journal screen, which already houses reflective, time-ordered content — history belongs there, not bolted onto Portfolio as a modal). The current modal framing is the single biggest thing I throw out: a story that scrolls for years cannot live in a 600px dialog. Reached three ways: the Journal sub-nav, a **"See the full story"** link on each holding's detail, and the Portfolio Holdings header's existing affordance now deep-links here scoped to that fund. The page accepts a `?fund=` scope so it reads as either **one fund's biography** or the **whole portfolio's chronicle**.

## 4. The main view — ASCII mockup

Whole-portfolio chronicle. Generous left rail = the timeline spine; entries hang off it.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  THE STORY SO FAR                              [ All funds ▾ ]   [ + Record ]   │
│  Forty-one entries since March 2022 · ฿1,284,500 put to work                   │
│                                                                                │
│  ┌── this portfolio today ────────────────────────────────────────────────┐   │
│  │  ฿1,612,400  market value    +฿327,900 unrealised   ╱╲╱╲▁▂▃▅  +25.5%    │   │
│  │  MONEY-WEIGHTED RETURN  14.2% /yr   ·   BANKED SO FAR  +฿84,200          │   │
│  └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                                │
│  ────────────────────────────────────────────────────────  2024  ──────────── │
│   │                                                                            │
│   ●  19 NOV   Sold  SCBSET                                  −16,400 units      │
│   │           Took profit after the SET run-up.              ฿182,000 out      │
│   │           ┌ realised +฿38,400 (+26.7%) ┐  banked, not on paper            │
│   │                                                                            │
│   ●  04 SEP   Dividend  EXAMPLE-FUND-A                       +฿3,120 income    │
│   │           Paid out — not reinvested.                                       │
│   │                                                                            │
│   ●  12 MAR   Bought  K-EQUITY                              +2,940 units       │
│   │           Monthly contribution.                          ฿45,000 in        │
│   │                                                                            │
│   ────────────────────────────────────────────────────────  2023  ──────────── │
│   │                                                                            │
│   ◆  01 JAN   Restatement  K-EQUITY              units re-anchored to 18,200   │
│   │           You corrected the running balance here.                          │
│   │                                                                            │
│   ●  22 NOV   Bought  EXAMPLE-FUND-A                        +5,000 units       │
│   │           ฿18.40 / unit                                  ฿92,000 in        │
│   │                                                                            │
│   ⟡  ── quiet note ── By end of 2023 you'd invested ฿840,000 across 4 funds.   │
│   │                                                                            │
│   ────────────────────────────────────────────────────────  2022  ──────────── │
│   │                                                                            │
│   ◆  01 MAR   Starting balance  K-EQUITY                    15,260 units       │
│   │           Where this record begins · avg cost ฿12.10                       │
│   ╵                                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

Reading rules: **mono** for every number, date, and ticker; serif-weighted system sans for the one-line annotations. Color is rationed — `--accent` green dot for buys/income, `--loss` red for sells, `--accent-2` teal diamond `◆` for anchors (Starting balance / Restatement), a hollow `⟡` for auto-generated milestone notes. The realised-gain chip under a sell is the only boxed element in the flow, because banked money is the one fact the eye should catch. Year rules are the chapter breaks. The note rows (`⟡`) are generated from `contributions` / `basisTimeline` — "By end of 2023 you'd invested ฿840,000" — turning analytics into prose instead of a second chart.

## 5. Recording activity — ASCII mockup

`+ Record` opens a **right-side drawer** (not a modal over the story — the story stays visible behind it so you see where the new chapter lands). One drawer, three on-ramps stacked top to bottom: a single thoughtful entry, or a paste/screenshot for a batch. The confirmation step is itself **a preview of the timeline**, so what you review looks like what you'll read.

```
                                     ┌──────────────────────────────────────────┐
                                     │  Record what happened              [ × ] │
                                     │  We never trade for you — you tell us.    │
                                     │                                          │
                                     │  understood as  ( Buy ) Sell  Dividend    │
                                     │                    Fee  Split  Reinvest  │
                                     │                                          │
                                     │  WHEN          WHICH FUND                │
                                     │  [2024-12-02]  [ K-EQUITY        ▾ ]      │
                                     │  HOW MUCH WENT IN        UNITS  (or)      │
                                     │  [ ฿ 45,000 ]            [ 2,940 ]        │
                                     │  ┄ price ฿15.31/unit · fee ฿0  (derived)  │
                                     │  A line for the story (optional)         │
                                     │  [ Monthly contribution.            ]    │
                                     │                                          │
                                     │  ─────────  or bring a batch  ─────────  │
                                     │  ⟦ Paste rows ⟧   ⟦ Upload screenshot ⟧  │
                                     │                                          │
                                     │             [ Add this chapter  ✓ ]      │
                                     └──────────────────────────────────────────┘
```

**Bulk / OCR confirm** — paste or a screenshot drops you into a *story preview*, each parsed row already rendered as a timeline entry with any uncertain field tinted `--amber`. You scroll the proposed chapters and tap one to correct it in place; nothing is a grid.

```
   We read 6 entries from your screenshot. Review the story, then save.
   ─────────────────────────────────────────────  2024  ────────────
    ●  12 MAR  Bought  K-EQUITY        +2,940 u    ฿45,000 in   [edit]
    ●  09 FEB  Bought  K-EQUITY        +2,880 u    ฿44,100 in   [edit]
    ●  18 JAN  Dividend EXAMPLE-FUND-A             ⟨฿ amount?⟩   ‹amber›
   ─────────────────────────────────────────────────────────────────
                          [ Save 6 chapters ✓ ]   [ Discard ]
```

**Starting balance** is just the first chapter of a fund's thread — phrased as *"Where this record begins"*, never "opening". Avg cost is optional; if left blank, a muted line reads *"Cost basis unknown — gains stay hidden until you add it,"* and the fund's banked-gain figures politely show `—` rather than a wrong number.

## 6. Editing & deleting

Tap any entry and it **expands in place into an editable card** — the row unfolds downward inside the timeline, spine intact, so you never lose your reading position. Save collapses it back into prose; the annotation line is editable too, because the story is yours to author.

```
   ●  12 MAR  Bought  K-EQUITY                      +2,940 units
   ╎  ┌─────────────────────────────────────────────────────────┐
   ╎  │ [2024-03-12] [Buy ▾] [K-EQUITY] [2940 u] [฿15.31] [฿45,000]│
   ╎  │ note [ Monthly contribution.            ]                 │
   ╎  │           [ Remove chapter ]      [ Cancel ] [ Save ✓ ]   │
   ╎  └─────────────────────────────────────────────────────────┘
```

Deleting an ordinary entry is immediate (with an undo toast). Deleting an **anchor** (Starting balance / Restatement) routes through a guard, because it re-bases every chapter downstream:

```
   ┌─ Remove the starting balance for K-EQUITY? ───────────────┐
   │ This is where the record begins. Removing it recomputes    │
   │ every chapter built on top — 14 entries, ฿0 banked figure  │
   │ may change.                          [ Keep ] [ Remove ]   │
   └────────────────────────────────────────────────────────────┘
```

## 7. How performance & realized gains surface

Performance is **woven into the prose, not parked in a stat dashboard.** Three homes, no clutter:

- **The standing summary card** (top of the story) carries the three figures that describe the whole arc: money-weighted return (IRR), unrealised vs realised, and total put to work. When IRR is null it reads *"Return settles after about a month of activity"* — explaining the gap the way the brief asks, instead of showing a dash.
- **Realised gain lives at the moment it happened** — the boxed chip under each sell, *"+฿38,400 (+26.7%) banked, not on paper."* That is the editorial payoff: you read banked money where the story earned it.
- **Cost basis & contributions become milestone notes** (`⟡` rows) at year boundaries, drawn from `basisTimeline` / `contributions`, so the trend is narrated ("By end of 2023 you'd invested ฿840,000") rather than charted. A single small `Sparkline` rides inside the summary card for the value arc — the one chart that survives.

## 8. Empty & first-run state

No grid, no zero-stat dashboard — an invitation to start writing.

```
┌──────────────────────────────────────────────────────────────────┐
│                          ▕ book icon ▏                            │
│                  Your story hasn't started yet.                   │
│                                                                   │
│   Record a buy, or bring a statement, and we'll turn it into a    │
│   timeline — with your banked gains, money-weighted return, and   │
│   the arc of everything you've put to work.                       │
│                                                                   │
│      [ Record the first chapter ]    [ Bring a statement ]        │
│                                                                   │
│   Already holding something? Set a starting balance — the point   │
│   where your record begins.                                       │
└──────────────────────────────────────────────────────────────────┘
```

## 9. Responsive / mobile

The timeline **is** a mobile pattern — vertical, single-column, thumb-scrollable; the desktop spine just narrows and entries stack their number under their label. The summary card sticks to the top as you scroll a fund's thread. `+ Record` becomes a full-height bottom sheet with the same three on-ramps.

```
┌─────────────────────────┐
│ THE STORY SO FAR    [+]  │
│ ฿1,612,400 · +25.5%      │
│ ──────────── 2024 ─────  │
│  ● 19 NOV  Sold SCBSET   │
│    ฿182,000 out          │
│    ┌ +฿38,400 banked ┐   │
│  ● 12 MAR  Bought K-EQ   │
│    ฿45,000 in            │
└─────────────────────────┘
```

## 10. Why this wins

- **It answers "how did I get here?" in one read.** A dense table makes you reconstruct the arc yourself; the timeline *is* the arc — chapters, milestones, and banked gains in narrative order, the way the brief's "one source of truth" actually wants to be felt.
- **It collapses holdings and history into a single honest object.** The standing summary is just "where the story has gotten to," sitting atop the entries that produced it — no Holdings/Activity toggle, no sense of two disconnected features.
- **Performance reads as meaning, not as a number-wall.** Realised gain appears where it was earned; IRR and contributions are narrated. The same analytics, made legible to a non-finance person.

**The honest tradeoff:** a timeline is gorgeous for tens-to-hundreds of entries but a poor *bulk-audit* surface — someone reconciling 800 rows against a broker statement, or wanting to sort by amount, will miss the scannable grid. I mitigate with fund-scoping, a collapse-years control, and a hidden "plain table" escape hatch for power reconciliation, but I'm deliberately optimising for the reflective monthly investor this app is built for, not the day-trader.
