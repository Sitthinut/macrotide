# macrotide — Recording & Reviewing Your Investing History

**Design A — Editorial / private-bank calm**

---

## Point of view

A brokerage app treats your money as a database: rows, columns, a "+" button, a
modal that asks you to classify everything. macrotide should treat it as a
**document** — the considered, beautifully typeset annual statement a private bank
once printed and mailed, now reimagined as software you can write back into.

So the governing metaphor here is **the statement, not the spreadsheet.** History
is set in columns of prose and figures, separated by hairline rules, paced by
generous vertical rhythm. Numbers live in mono and stay perfectly aligned so the
eye can run down them. Color is almost absent — a single green for gain, a single
red for loss, an amber for caution — and it *means* something every time it
appears. There are no stat-wall dashboards, no card grids of metrics, no
loud buttons. Meaning comes from hierarchy and whitespace.

The frozen spine — **one ledger, holdings are a projection of it** — is a gift to
this aesthetic. A statement *is* a ledger that has been read aloud. "What I hold"
and "how I got here" are not two features; they are the running total and the
entries above it, on the same page. The whole design leans into that: every
position page is its history with a summary set at the top, like the closing
balance printed under a column of transactions.

A note on labels: the user never sees "opening balance" or "snapshot." A position
held before tracking began is a **Starting balance**. A correction to a running
balance is a **Restatement**. The AI is **Advisor**, always.

---

## 1. The single event — the core atom

Every event is one **line in a statement**, not a card and not a table row. It has
a strict left-to-right reading order: *date · what happened · the asset · the
figures*. Tickers and all numbers are mono; the human description is sans. The
**amount is the rightmost, heaviest element** and is the only thing that ever
carries color.

A small mono glyph in the left margin marks the kind — a typographic mark, not a
colored chip. Buys and sells are the spine; income (dividend, reinvest), cost
(fee), and structure (split) are quieter; the two anchors are set apart entirely.

```
 ┌─ kind mark (mono, in the margin gutter — never a colored pill)
 │
 +   12 Mar 2026   Bought   EXAMPLE-FUND-A             ฿20,000
                   142.31 units · ฿140.53/unit                    ← detail line, --muted
 ─────────────────────────────────────────────────────────────  ← --line-soft hairline
 −   28 Feb 2026   Sold     GLOBAL-ETF-B               ฿15,400
                   90.00 units · ฿171.11/unit    ·  +฿2,180 gain   ← realized gain, --gain
 ─────────────────────────────────────────────────────────────
 ◦   15 Feb 2026   Dividend  EXAMPLE-FUND-A              ฿412
                   paid in cash · source: Broker statement
 ─────────────────────────────────────────────────────────────
 ↺   15 Feb 2026   Reinvested DIV-FUND-C                ฿412
                   2.61 units · ฿157.85/unit
 ─────────────────────────────────────────────────────────────
 ·   31 Jan 2026   Fee       —                          −฿150
                   platform fee · source: Broker statement
```

How the kinds differ:

- **Buy / Sell** carry the `+` / `−` marks and the full figure line. Only a
  **Sell** ever shows a realized gain, and it reads as a clause *after* the price —
  `+฿2,180 gain` in `--gain`, or `−฿340 loss` in `--loss`. The gain is banked
  money; it belongs to the sell line where it happened, never an orphaned metric.
- **Dividend / Reinvest** use the `◦` and `↺` marks, in `--ink-soft`. Amounts are
  neutral ink, not green — they are income, not market gain, and overusing green
  would cheapen it.
- **Fee** is the quietest line: a `·` mark, a negative amount in plain ink, no
  units.
- **Split** reads as structure, not money: `7 Jan 2026 · Split · EXAMPLE-FUND-A ·
  2-for-1 · 142.31 → 284.62 units` with **no amount column** — the right edge is
  deliberately empty, signaling "nothing moved in or out."

The two **anchors are set apart** — indented under a small-caps mono label and ruled
above with a slightly darker line, so they read as *the page's premises* rather than
events:

```
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ← --line (heavier)
   STARTING BALANCE
   01 Jan 2024   EXAMPLE-FUND-A        1,000.00 units   ฿138,000
                 cost basis not recorded                         ← cost-unknown, --amber
 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

A **Restatement** reads as an editorial correction, like an erratum line:
`RESTATED · 01 Mar 2026 · EXAMPLE-FUND-A · balance set to 845.00 units · “units
reconciled with broker”` in `--ink-soft`, with the note as the justification.

**Interaction.** The whole line is one quiet tap target. Tapping doesn't open a
modal — it **expands the line in place** into a few rows of detail and an edit
affordance (see §4). Hover on desktop reveals a hairline `pencil` at the right
margin. No row ever has a visible button until you reach for it.

---

## 2. The portfolio-wide history surface — "The Ledger"

History is a **first-class screen**, reached from the home and from the bottom nav
(`book` icon, labelled **History**). It is never a dialog. Its title is set like a
document header, and the default has-data state reads top to bottom as a statement
**grouped by month**, newest first, with running context in the gutter.

```
 ┌───────────────────────────────────────────────────────────────────────┐
 │  ‹                                                              search ⌕│
 │                                                                         │
 │  History                                                                │
 │  Everything you've recorded, most recent first                          │  ← sans, --muted
 │                                                                         │
 │   All  ·  Buys  ·  Sells  ·  Income  ·  Fees  ·  Anchors      ⟂ filter  │  ← quiet text filters
 │ ─────────────────────────────────────────────────────────────────────  │
 │                                                                         │
 │   MARCH 2026                                       net invested ฿18,500 │  ← month header + roll-up
 │                                                                         │
 │   +  12 Mar   Bought   EXAMPLE-FUND-A                        ฿20,000    │
 │              142.31 units · ฿140.53/unit                                │
 │   ·  09 Mar   Fee      —                                       −฿150    │
 │   ─                                                                      │
 │   −  03 Mar   Sold     GLOBAL-ETF-B                          ฿15,400    │
 │              90.00 units · ฿171.11/unit   ·  +฿2,180 gain               │
 │                                                                         │
 │   FEBRUARY 2026                                    net invested ฿4,200  │
 │                                                                         │
 │   ◦  28 Feb   Dividend EXAMPLE-FUND-A                          ฿412     │
 │   +  14 Feb   Bought   ASIA-FUND-D                           ฿4,000     │
 │              25.04 units · ฿159.74/unit                                 │
 │   …                                                                     │
 │ ─────────────────────────────────────────────────────────────────────  │
 │                                                                         │
 │   STARTING BALANCES                                                     │  ← anchors collected
 │   01 Jan 2024   EXAMPLE-FUND-A   1,000.00 units   ฿138,000   cost n/a   │
 │   01 Jan 2024   SCBSET           520.00 units     ฿62,400               │
 └───────────────────────────────────────────────────────────────────────┘
```

- **Grouping & rhythm.** Months are the grouping unit — a statement covers
  periods, not infinite scroll of undifferentiated rows. Each month header carries
  one roll-up figure on the right: **net invested** that month (a number the brief
  gives us). It is the only metric here; everything else is the entries themselves.
- **Sort.** Newest-first by `tradeDate` is the only default; "Oldest first" lives
  under the filter affordance for anyone reconstructing a timeline.
- **Filter.** The kind filters are **text, not chips** — small-caps mono words
  separated by middots. Tapping one underlines it. The `⟂ filter` affordance opens
  an inline tray (not a modal) for date range and per-fund scoping.
- **Anchors live at the bottom**, collected under a `STARTING BALANCES` heading,
  because they are the premises the whole ledger rests on — the foundation you
  read last, like the opening positions footnoted in a statement.
- **Search** (`⌕`) filters by ticker or note across the whole ledger.

This single surface is reused, *scoped*, as the body of every single-position page
(§6) — same atom, same grouping, just filtered to one ticker. One ledger, read at
two zoom levels.

---

## 3. Recording & importing — "Add to your record"

Recording is one entry point, the `plus` in the home header, labelled **Add**. It
opens an **overlay** (centered panel on desktop, full-bleed bottom sheet on
mobile). The overlay never asks the user to classify anything first. It offers
three quiet ways in, set as a short list, not a tab bar:

```
 ┌──────────────────────── Add to your record ───────────────────────────┐
 │                                                                        │
 │   How would you like to add this?                                      │
 │                                                                        │
 │   ▢  Photograph a broker screen        most common                     │  ← OCR
 │   ▢  Paste from a statement or CSV                                     │
 │   ▢  Type one entry by hand                                            │
 │                                                                        │
 │   Either a list of your current holdings or a buy/sell history is      │
 │   fine — macrotide will read it and tell you which it found.           │  ← sets expectation, no mode-pick
 └────────────────────────────────────────────────────────────────────────┘
```

### The auto-detect moment (photo or paste)

After OCR/parse, the app runs the classifier and **states its conclusion in plain
words** before showing any table. This is the heart of the no-classify-it-yourself
principle: the user reads one sentence and either nods or taps once to flip it.

```
 ┌──────────────────────── Reading your screen… ──────────────────────────┐
 │                                                                        │
 │   We read this as a list of what you hold right now.                   │  ← the verdict, plain
 │                                                                        │
 │   That means each line becomes a Starting balance — the position you   │
 │   held before you began tracking here.                                 │  ← explains the consequence
 │                                                                        │
 │           This is actually a buy / sell history  ›                     │  ← one tap to flip, --accent text
 │                                                                        │
 │ ─────────────────────────────────────────────────────────────────────  │
 │   We found 4 positions                                                 │
 └────────────────────────────────────────────────────────────────────────┘
```

The flip link is phrased as the *other* interpretation in plain language, so the
user corrects by recognition, never by learning a taxonomy. Flipping re-renders
the same rows under the other reading.

### The editable confirmation (the proof sheet)

Then — and only then — the parsed rows appear, set as the **same statement lines**
the user will live with, fully editable in place. It is a *proof sheet*: read it,
fix a misread digit, confirm. OCR-uncertain fields are underlined in `--amber` and
focused first.

```
 ┌──────────────────── Confirm before saving ─────────────────────────────┐
 │   Read as: Current holdings → 4 Starting balances        ⌄ change       │
 │ ─────────────────────────────────────────────────────────────────────   │
 │                                                                          │
 │   EXAMPLE-FUND-A     1,000.00 units    ฿138,000    cost basis  [   ? ]   │  ← amber: cost unknown
 │   SCBSET               520.00 units    ฿ 62,400    cost basis  ฿58,000   │
 │   ASIA-FUND-D          ⎡310.00⎤ units  ฿ 49,200    cost basis  ฿47,500   │  ← amber underline = low confidence
 │   K-EQUITY             880.00 units    ฿101,300    cost basis  ฿ 95,000  │
 │                                                                          │
 │   Dated as held on   [ 01 Jan 2024 ]                                     │  ← one date for the whole snapshot
 │ ─────────────────────────────────────────────────────────────────────   │
 │                       Discard            Save 4 Starting balances        │
 └──────────────────────────────────────────────────────────────────────────┘
```

If it had been read as **activity** instead, the same proof sheet shows event lines
(date · kind · ticker · units · price · amount), each kind inferred and shown, each
editable — the dominant column being the running `amount`.

### One entry by hand

Typed entry is **not a grid of inputs** — it's a single composed sentence the user
fills, which keeps faith with the editorial voice and avoids the form-wall the
brief rejects:

```
 ┌──────────────────────── Type one entry ────────────────────────────────┐
 │                                                                          │
 │   On  [ 12 Mar 2026 ]  I  [ bought ⌄ ]                                   │  ← kind as inline select
 │                                                                          │
 │   [ 142.31 ] units of  [ EXAMPLE-FUND-A      ⌕ ]                         │  ← ticker autocompletes
 │   at  [ ฿140.53 ] per unit   →   ฿20,000                                 │  ← amount computes live, --ink
 │                                                                          │
 │   + add a fee     + add a note                                          │  ← progressive, optional
 │ ─────────────────────────────────────────────────────────────────────   │
 │                                   Cancel            Add entry            │
 └────────────────────────────────────────────────────────────────────────┘
```

The sentence reshapes by kind: "received a **dividend** of ฿412 from…", "paid a
**fee** of ฿150", "**split** EXAMPLE-FUND-A 2-for-1." Amount computes live but
stays editable for odd-lot reconciliation.

### Setting a Starting balance (cost-unknown)

A Starting balance can be set deliberately too (from a position's page, §6, or by
choosing "I already held this" in hand entry). The crucial case is **cost
unknown** — handled with a frank, friendly toggle rather than a forced number:

```
 ┌─────────────────────── Starting balance ───────────────────────────────┐
 │                                                                          │
 │   I already held   [ 1,000.00 ] units of  [ EXAMPLE-FUND-A ]             │
 │   as of  [ 01 Jan 2024 ]                                                 │
 │                                                                          │
 │   What I originally paid                                                 │
 │     ◉  I don't have this on hand                                         │  ← default; honest
 │     ○  ฿ [            ]  total cost                                      │
 │                                                                          │
 │   Without a cost, we'll value this position at today's price and        │
 │   show gains only from here forward. You can add the cost later.        │  ← consequence, plain
 └──────────────────────────────────────────────────────────────────────────┘
```

The consequence is stated honestly: no cost means **return is measured from today
forward**, and the position page (§6) will carry a quiet "cost basis not recorded"
line until it's filled. This is far kinder than a `฿0` that silently poisons every
downstream gain.

---

## 4. Editing & deleting — in place

Editing happens **where the event lives**, by expanding the line — never by hunting
it down in a separate management screen. Tapping a line opens it into a small
editable block beneath, with the figures becoming fields and two quiet actions at
the foot.

```
   −  03 Mar   Sold     GLOBAL-ETF-B                          ฿15,400
              90.00 units · ฿171.11/unit   ·  +฿2,180 gain
   ┌─ expanded ──────────────────────────────────────────────────────────┐
   │   units [ 90.00 ]   price ฿[ 171.11 ]   fee ฿[ 0 ]                    │
   │   note  [ trimmed position into strength            ]                 │
   │   source  Broker statement                                           │
   │                                                                       │
   │   Realized gain recalculates to +฿2,180 when you save.               │  ← shows the consequence
   │                                                                       │
   │            Delete entry            Cancel            Save changes     │
   └───────────────────────────────────────────────────────────────────────┘
```

- **Editing a normal event** shows, before saving, the one downstream figure it
  moves (here the realized gain) so the edit's effect is never a surprise.
- **Deleting a normal event** is a single quiet confirm inline: "Delete this sell?
  Your holdings will update." No modal stack.

### The Starting-balance delete guard

A Starting balance is the **premise of everything after it**, so deleting one is
guarded — not with a generic "are you sure," but with a plain statement of the
blast radius, set in the editorial voice:

```
 ┌──────────────────── Delete this Starting balance? ─────────────────────┐
 │                                                                          │
 │   STARTING BALANCE · EXAMPLE-FUND-A · 1,000 units · 01 Jan 2024          │
 │                                                                          │
 │   This is the foundation of your EXAMPLE-FUND-A record.  Removing it     │
 │   recomputes everything that followed:                                  │  ← --amber rule above
 │                                                                          │
 │     ·  14 later entries re-based                                         │
 │     ·  average cost and units recalculated                              │
 │     ·  realized gains on 2 past sells may change                        │
 │                                                                          │
 │   Type  DELETE  to confirm.   [            ]                             │  ← friction proportional to risk
 │ ─────────────────────────────────────────────────────────────────────   │
 │                      Keep it            Delete and recompute             │  ← destructive action in --loss
 └──────────────────────────────────────────────────────────────────────────┘
```

The type-to-confirm friction is reserved *only* for anchor deletes — ordinary
edits stay frictionless. Risk earns ceremony; routine doesn't.

---

## 5. The Portfolio home — "How's my money?"

The home answers the headline question **in one line of type before any row is
read.** No stat wall. A single large total, a single contextual change figure, and
a hairline sparkline — set like the cover figure of a statement.

```
 ┌───────────────────────────────────────────────────────────────────────┐
 │                                                              ⌕      + Add│
 │                                                                         │
 │   Your portfolio                                          4 Jun 2026    │  ← small-caps mono date
 │                                                                         │
 │   ฿  4 0 2 , 8 6 0                                                       │  ← the headline. large, mono, tracked
 │   ▲ ฿12,400  ·  +3.2%   this month            ╱╲___╱──╲_╱──            │  ← --gain + hairline sparkline
 │                                                                         │
 │ ─────────────────────────────────────────────────────────────────────  │
 │                                                                         │
 │   POSITIONS                                              value · today  │  ← small-caps column label
 │                                                                         │
 │   EXAMPLE-FUND-A    1,142 units · avg ฿138.0      ฿161,400   ▲ 2.1%     │  ← one line per position
 │   K-EQUITY            880 units · avg ฿115.1      ฿104,720   ▲ 3.4%     │
 │   GLOBAL-ETF-B        210 units · avg ฿168.4      ฿ 38,900   ▼ 0.6%     │
 │   SCBSET              520 units · avg ฿120.0      ฿ 62,400   ▲ 1.0%     │
 │   ASIA-FUND-D         335 units · avg ฿159.2      ฿ 35,440   price n/a  │  ← --muted when no price
 │ ─────────────────────────────────────────────────────────────────────  │
 │                                                                         │
 │   RECENTLY RECORDED                                        all history ›│  ← teases history, links out
 │   +  12 Mar   Bought EXAMPLE-FUND-A   ฿20,000                           │
 │   −  03 Mar   Sold   GLOBAL-ETF-B     ฿15,400  +฿2,180                  │
 │   ◦  28 Feb   Dividend EXAMPLE-FUND-A ฿412                              │
 └───────────────────────────────────────────────────────────────────────┘
```

- **The headline** is the only large number in the whole app. Its change figure is
  *contextual* — "this month" — not a free-floating metric; tapping it cycles the
  window (month / year / all). The sparkline is hairline, area-light, no axes.
- **Positions** is the projection of the ledger — each is a single statement line,
  and **tapping one navigates to its page (§6).** This is the fluid move from
  whole-portfolio to single-position the brief demands: a tap, a screen push, a
  back-chevron return.
- **Recently recorded** *teases* history with three lines and a quiet `all history
  ›` link into §2. It proves the home and the ledger are the same material.
- Performance lives **in context**: realized gain shows on its sell line; portfolio
  XIRR and invested-total live one step deeper under a "Performance" affordance on
  this screen and on each position page — never dumped here as orphaned cards.

---

## 6. The single-position page — summary above its history

This is the design's thesis made literal: **a fund's running summary set at the
top of the very history that produced it.** Reached by tapping a position on the
home or any ticker in the ledger. Back is a chevron.

```
 ┌───────────────────────────────────────────────────────────────────────┐
 │  ‹  Your portfolio                                          ⌕     ⋯     │
 │                                                                         │
 │   EXAMPLE-FUND-A                                                        │  ← ticker, mono, large
 │   Example Asia Equity Fund                                              │  ← englishName, sans, --muted
 │                                                                         │
 │   ฿161,400        1,142 units · avg cost ฿138.0                         │  ← value + position, one line
 │   ▲ ฿23,400 unrealized  ·  +17.0%                                       │  ← --gain
 │                                                                         │
 │   ┌─ Cost basis vs. value ─────────────────────────────────────────┐   │
 │   │  ฿                                              ╱──── value      │   │  ← area: value, --accent
 │   │                                       ╱────────╱                 │   │
 │   │                            ╱─────────╱   ┄┄┄┄┄┄┄┄┄┄ cost basis   │   │  ← stepped line, --muted
 │   │              ╱────────────╱   ┄┄┄┄┄┄┄┄                           │   │
 │   │   ┄┄┄┄┄┄┄┄┄┄┄                                                    │   │
 │   │   2024            2025            2026                           │   │
 │   └────────────────────────────────────────────────────────────────┘   │
 │                                                                         │
 │   Realized to date  +฿2,180     ·     Money-weighted return  +14.2%     │  ← per-fund analytics, in context
 │   Income received   ฿1,236      ·     Total invested  ฿138,000          │
 │ ─────────────────────────────────────────────────────────────────────  │
 │                                                                         │
 │   THIS FUND'S RECORD                                      + Add entry   │
 │                                                                         │
 │   +  12 Mar 2026   Bought    142.31 units · ฿140.53        ฿20,000      │
 │   ◦  15 Feb 2026   Dividend  paid in cash                  ฿412         │
 │   −  20 Jan 2026   Sold      90.00 units · ฿171.11  +฿2,180 ฿15,400     │
 │   …                                                                     │
 │   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
 │   STARTING BALANCE                                                      │
 │   01 Jan 2024      1,000.00 units · cost ฿138,000                       │
 └───────────────────────────────────────────────────────────────────────┘
```

- **Summary first, history below.** The top block answers "where does this stand"
  in one breath; the record below answers "how did it get here." They share the
  page because they share the ledger.
- **The cost-basis-vs-value chart** is the page's one piece of color: an `--accent`
  area for market value over a **stepped `--muted` cost-basis line** (cost basis
  moves in steps — it only changes when you buy or sell). The gap between them *is*
  the unrealized gain, shown visually. No axes clutter; two labels and three year
  ticks.
- **Per-fund analytics in context:** realized, money-weighted return, income, and
  total invested sit as a quiet four-figure rule *between* the summary and the
  record — describing the position they belong to, scoped to this fund.
- The history below is **§2's exact atom**, filtered to this ticker, anchor pinned
  at the foot. `+ Add entry` here pre-fills the ticker.

---

## 7. Every state

**Empty / first-run.** No dashboard skeleton. A single centered line of editorial
copy and one action — the blank first page of a ledger waiting to be written:

```
        Your record is empty.

        Start by adding what you already hold, or your
        recent activity at your broker. A photo of your
        broker screen is the quickest way.

                  [ Add your first entry ]
```

**Loading.** Hairlines and labels render immediately; figures resolve in place as
faint `--muted-2` placeholder digits (`฿ ───,───`) that settle into real numbers.
The *structure* never flickers — only the values fill, like ink drying. No spinners
on the home; a single thin `pulse` line under the header while quotes refresh.

**Cost-unknown.** Anywhere a position lacks cost basis, a quiet `--amber` line —
"cost basis not recorded" — replaces the gain figure, with a one-tap `add cost ›`.
We never fabricate `฿0` or a fake return.

**Return-not-available-yet** (XIRR null, <~28 days of activity). Never a bare dash.
A short human reason in `--muted`, in the analytics rule:

```
   Money-weighted return   —   not enough history yet
                               (we'll show this after about a month)
```

**Price-unavailable** (`marketValue` null). The position keeps its units and avg
cost; the value column reads `price n/a` in `--muted` and the headline total notes
"1 position not priced" in small mono, so the grand total never silently lies.

**Error** (parse/OCR/save failure). Plain, owned, recoverable — never a stack
trace, never red panic:

```
   We couldn't read that image clearly.

   Try a sharper screenshot, or paste the figures as text
   instead. Nothing was saved.

        [ Try another photo ]    [ Paste text ]
```

---

## Component inventory

The whole system is built from a small kit, reused at every zoom level:

- **EventLine** — the atom (§1). One row: kind-mark gutter, date, verb, ticker,
  detail line, amount. Variants by `kind`; the only colored element is the amount /
  realized-gain clause. Used in the ledger, the home tease, and position pages
  identically.
- **AnchorLine** — Starting balance / Restatement variant: heavier rule, small-caps
  label, indented, cost-unknown amber state.
- **StatementGroup** — a month (or "Starting balances") header with one roll-up
  figure, wrapping a run of EventLines.
- **Headline** — the one large tracked-mono total with a contextual change figure
  and hairline sparkline (home + position summary share it).
- **PositionLine** — a single holding as one statement line (ticker, units, avg
  cost, value, change); the tap target into a position page.
- **AnalyticsRule** — a hairline-separated row of two-to-four labelled figures
  (realized · return · income · invested), always *in context*, never a card grid.
- **ProofSheet** — the editable confirmation table for imports (§3), with
  amber-underlined low-confidence fields.
- **VerdictBanner** — the plain-language "we read this as…" + one-tap flip (§3).
- **ComposeSentence** — the single-sentence hand-entry composer (§3).
- **InlineEditor** — the expand-in-place edit block (§4).
- **GuardDialog** — risk-proportional confirm; type-to-confirm only for anchors.
- **CostValueChart** — area (value) over stepped line (cost basis), SVG, axis-light.
- **Sparkline** — hairline area, no axes, for headlines.
- **QuietFilters** — small-caps mono text filters with a middot separator + a
  filter tray.

Two surface types carry them: **Screens** (Home, History, Position, plus the
Add overlay's full-bleed mobile form) and **Overlays** (centered panel / bottom
sheet for Add, confirm, and guards). Everything else is composition.

---

## Motion / transition

Motion is **editorial, not animated** — the feeling of a well-made page turning,
never a UI showing off. Three rules. (1) **Navigation is a quiet horizontal push:**
into a position page, the new screen slides in from the right over ~180ms with a
soft ease, the back-chevron reverses it — paper sliding, not a zoom. (2)
**Expansion is height, not overlay:** editing an event or opening the filter tray
*grows* the line/section in place (~140ms ease-out), so context never leaves the
page; the rest of the statement reflows gently rather than being covered. (3)
**Numbers settle, they don't spin:** placeholder digits cross-fade into real
figures and changed totals tick up over ~400ms with a count-up easing, like ink
resolving — no bounce, no flash. Overlays fade-and-rise ~12px on mobile (the bottom
sheet) and fade-only on desktop. Color transitions (a gain turning to loss on edit)
cross-fade rather than snap. The through-line: every transition should feel like
something settling into place, calm and inevitable, never demanding attention. The
app should feel like it's *reading you the statement*, unhurried.
