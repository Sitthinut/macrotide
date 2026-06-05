# macrotide — Recording & Reviewing Investing History

**Design C — Precise instrument / data-forward elegant.**

> Linear's discipline meets a refined Bloomberg terminal, kept calm. Information-dense but
> impeccably ordered. Every column aligns, every number is mono, every pixel earns its place.
> I trust the user with real ฿ and give them structure instead of friendly cards that bury it.
> Power and clarity over hand-holding.

---

## 0. The one idea that organizes everything

There is **one ledger**. A holding is just that ledger, summed. So I refuse to build two
features. I build **one object — the Position Line — at three zoom levels**:

- **Portfolio zoom** — every position as one dense row; the home screen *is* the ledger summed.
- **Position zoom** — one fund's running summary sitting directly on top of the events that
  produced it. No seam between "what I hold" and "how I got it."
- **Event zoom** — the single atom, expandable in place.

You never "open the history." History is always already there; you change altitude. The whole
system is one ruled, mono-aligned register that you fly up and down through. That is the
terminal feeling — one continuous instrument, not a deck of dialogs.

Two global rails frame every screen:

- A persistent **command bar** (`⌘K` / tap the `+`) — the only way activity is recorded. One
  door for one-off, paste, CSV, photo. No scattered "Add" buttons.
- A right-edge **inspector** (desktop) / bottom sheet (mobile) — selecting any row reveals its
  detail there. Selection, never navigation, for inspection.

---

## 1. The single event — the core atom

Events live in a **register**: a fixed 12-column mono grid. Every row is the same skeleton; the
`kind` only re-colors and re-signs it. This consistency is the whole point — the eye learns one
shape and reads a hundred rows without re-parsing.

```
 DATE      KIND      INSTRUMENT          UNITS      PRICE      AMOUNT     ⊕
─────────────────────────────────────────────────────────────────────────────
 04 Jun    BUY       EXAMPLE-FUND-A      +412.50    ฿24.21    −฿9,987    ›
 28 May    DIV       EXAMPLE-FUND-A         —          —      +฿1,204    ›
 21 May    SELL      K-EQUITY           −200.00     ฿58.40   +฿11,680   ›   ▲ +฿1,240
 02 May    FEE       SCBSET                 —          —        −฿35     ›
 15 Apr    SPLIT     GLOBAL-X            ×2 (3:2)      —          —       ›
 — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — —
 ⌂ START   EXAMPLE-FUND-A · before 01 Jan 2026 · 1,000.00 u · cost unknown   ›
```

Reading rules, committed hard:

- **Sign is the signal.** Cash leaving you is `−฿` in `--ink`; cash arriving (`SELL`, `DIV`) is
  `+฿` in `--gain`. `UNITS` signs the same way (`+` acquired, `−` disposed). No red/green
  confetti — color is reserved for *meaning*, not decoration.
- **KIND is a 5-char mono tag**, not a pill. `BUY DIV SELL FEE SPLIT REINV` — small-caps,
  `--muted`, letter-spaced. Tags don't need boxes when they're already monospaced and aligned.
- **Realized gain rides the SELL row**, right-aligned, after the amount, with a `▲`/`▼` glyph:
  `▲ +฿1,240` in `--gain`, `▼ −฿310` in `--loss`. It only ever appears on a sell — that is the
  *only* place money is actually banked, so it is the only place the number belongs (principle:
  "realized gain belongs where it was banked"). It is visually subordinate to AMOUNT (smaller,
  trailing) so it reads as a consequence, not a second number.
- **The anchor rows are typographically *other*.** A `⌂ START` (Starting balance) and `↺ REST`
  (Restatement) break the column grid into a single full-width statement line, set in italic
  `--ink-soft` against a faint `--line-soft` tint. They read as *margins of the ledger* — the
  ground the running balance stands on — not as trades. You feel instantly that they are
  different in nature.
- `SPLIT` shows a ratio (`×2 (3:2)`) where price would be, with em-dash amount — no cash moved.
- `⊕` / `›` is the expand affordance. Click anywhere on the row to select it into the inspector.

**Expanded event (inspector / tap on mobile):**

```
┌─ SELL · K-EQUITY ───────────────────────────── 21 May 2026 ─┐
│                                                              │
│   UNITS         −200.0000                                    │
│   PRICE         ฿58.40                                       │
│   PROCEEDS      +฿11,680                                     │
│   FEE           −฿35                                         │
│   ─────────────────────────────────────────                 │
│   COST BASIS    ฿10,440   (avg ฿52.20 × 200)                 │
│   REALIZED      ▲ +฿1,240    (+11.9%)                        │
│                                                              │
│   SOURCE   Broker statement · May    NOTE   trimmed on rally │
│                                                              │
│   [ Edit ]                                      [ Delete ]   │
└──────────────────────────────────────────────────────────────┘
```

Only the SELL inspector shows the cost-basis → realized derivation — because only there does it
exist. A BUY's inspector shows fee, source, note, and "this lot's running avg cost after." The
atom is honest about each kind instead of forcing a uniform form.

---

## 2. The portfolio-wide history surface — the Register

This is a **real screen** (`Activity`), reached from the home's tab rail and from any
"see all" — never a dialog. It is the ledger at full resolution: every event, every position,
one continuous mono register, newest first.

```
┌ ‹ Back                            ACTIVITY                         ⌘K ⊕ ┐
│                                                                          │
│  428 events · since Jan 2026          [ All ▾ ] [ Buys ] [ Sells ] [⊙]  │
│  ───────────────────────────────────────────────────────────────────── │
│  Realized YTD  ▲ +฿18,420     Invested  ฿512,000     Income  ฿9,840     │
│  ═══════════════════════════════════════════════════════════════════════│
│                                                                          │
│  JUNE 2026 ──────────────────────────────────────── net −฿9,987 ─────── │
│   04 Jun   BUY    EXAMPLE-FUND-A    +412.50   ฿24.21   −฿9,987      ›    │
│                                                                          │
│  MAY 2026 ──────────────────────────────────────────  net +฿12,849 ──── │
│   28 May   DIV    EXAMPLE-FUND-A       —        —      +฿1,204      ›    │
│   21 May   SELL   K-EQUITY         −200.00   ฿58.40  +฿11,680  ▲+1,240 › │
│   12 May   REINV  GLOBAL-X          +18.30   ฿41.10      ฿0         ›    │
│   02 May   FEE    SCBSET               —        —         −฿35      ›    │
│   ───────────────────────────────────────────────────────────────────  │
│  APR 2026 ──────────────────────────────────────────  net −฿24,500 ──── │
│   …                                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Grouped by month, with a running monthly net** right-aligned on each month rule —
  the contribution timeline made legible inline, no separate chart needed for the glance.
- **The three-stat strip pinned under the header** is the portfolio analytics *in context*:
  `realizedTotal`, `contributions` (invested), `incomeTotal`. They re-scope live to whatever the
  filter shows. (Filter to one fund → these become that fund's numbers.)
- **Filters are mono chips, not a faceted sidebar.** `All / Buys / Sells / Income / Fees`, plus
  `[⊙]` opening a thin filter row: instrument (typeahead), date range, source. Keyboard: `/`
  focuses filter, `j`/`k` move the cursor row, `↵` expands into the inspector, `e` edits.
- **Density is the feature.** ~40 events visible per laptop screen. No card has a shadow; rows
  are 28px, separated by `--line-soft` hairlines. This is where the "refined terminal" lives.
- Tap an INSTRUMENT cell → jump to that single-position page (filtered zoom). Tap the row body →
  inspector. Two targets, one row, both obvious.

Mobile: the same register, but the 12-col grid collapses to **two mono lines per event** (line 1:
date · kind · instrument; line 2: units · price · amount, right-aligned). Month rules and the
stat strip survive. It never becomes friendly cards — it stays a register, just narrower.

---

## 3. Recording / importing — one door, the app does the thinking

`⌘K` / `+` opens the **Record** overlay (centered panel desktop, full-bleed sheet mobile). One
surface, four ways in, no mode-picker:

```
┌──────────────────  RECORD ACTIVITY  ──────────────────┐
│                                                        │
│   Paste a statement, drop a screenshot, or type.       │
│   macrotide reads it and tells you what it found.      │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │                                                    │ │
│  │   ⤓  Drop a screenshot / CSV  ·  or paste here     │ │
│  │                                                    │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│   ─────────────────  or enter one  ─────────────────   │
│                                                        │
│   BUY ▾   EXAMPLE-FUND-A      04 Jun 2026              │
│   units  412.50    price ฿24.21    →  amount −฿9,987   │
│                                                        │
│                                  [ Add event ⏎ ]       │
└────────────────────────────────────────────────────────┘
```

**One-off** is a single inline mono row that computes the third field from the other two
(`amount = units × price`, live). Tab-through, `↵` commits, the overlay stays open for the next —
fast repeat entry, terminal-style. `kind` is a dropdown; the row's field set adapts (DIV hides
units/price, SPLIT swaps in a ratio field).

**Paste / CSV / photo** all feed the same pipe. On drop, the **classifier runs and the overlay
becomes a plain-language verdict** — this is the principle "never force a mode before they
understand the difference":

```
┌──────────────────  WHAT WE READ  ─────────────────────┐
│                                                        │
│   sparkle  This looks like your holdings right now —   │
│            5 funds you currently own.                  │
│                                                        │
│   We'll record these as Starting balances: the         │
│   positions you held before macrotide began tracking.  │
│                                                        │
│        ┌─────────────────────────────────────────┐     │
│        │  Not quite — this is buy/sell history ↺  │     │
│        └─────────────────────────────────────────┘     │
│                                                        │
│   ─────────────────────────────────────────────────    │
│   INSTRUMENT        UNITS        VALUE      ✎            │
│   EXAMPLE-FUND-A   1,000.00    ฿24,210      ›           │
│   K-EQUITY           420.00    ฿24,528      ›           │
│   SCBSET           1,200.00    ฿18,360      ›           │
│   GLOBAL-X            96.00     ฿3,946  ⚠ cost unknown   │
│   K-FIXED-A        2,000.00    ฿20,400      ›           │
│   ─────────────────────────────────────────────────    │
│   5 positions · ฿91,444 total                          │
│                                                        │
│              [ Looks right — record ฿91,444 ⏎ ]        │
└────────────────────────────────────────────────────────┘
```

The verdict is **one sentence in plain words + one tap to flip it.** The toggle isn't a
segmented "Snapshot | History" control shown upfront — it's the *correction*, offered only
after the app has committed to a guess. Flipping it re-reads the same rows as activity (the
table morphs: adds DATE/KIND/PRICE columns, drops the snapshot framing) so the user sees the
consequence of the flip immediately.

**The confirmation table is the import — fully editable.** Every cell is inline-editable mono
(click `✎` or any cell). OCR mistakes get fixed *here*, before anything is written — never a
post-import cleanup. Rows can be deleted (swipe / `⌦`). A row the classifier was unsure about is
flagged amber with a reason (`⚠ cost unknown`, `⚠ couldn't read date`) rather than silently
guessed.

**Bulk activity import** (when flipped to / detected as history) lands in the same table shape as
the register itself — date, kind, instrument, units, price, amount — so the confirm step is
literally a preview of how it will look once recorded. Continuity of object, again.

### Setting a Starting balance (and cost-unknown)

A Starting balance can also be set deliberately for one fund (from the position page's `⊕`, or
by typing it in Record). It is framed as a *fact about the past*, never as "opening balance":

```
┌────────────  STARTING BALANCE · GLOBAL-X  ─────────────┐
│                                                         │
│   A position you held before macrotide started.        │
│                                                         │
│   As of date     ┌ 31 Dec 2025 ▾ ┐                      │
│   Units held     ┌ 96.0000       ┐                      │
│                                                         │
│   Cost basis                                            │
│     ◉  I know what I paid     ┌ ฿3,600  total ┐         │
│     ○  I don't know my cost                             │
│        └ Returns will start from today's value; we'll   │
│          note that realized gain can't be computed for  │
│          units bought before tracking.                  │
│                                                         │
│                       [ Set starting balance ⏎ ]        │
└─────────────────────────────────────────────────────────┘
```

Cost-unknown is a **first-class, explained choice**, not an error. Choosing it doesn't block —
it records units with a null basis and the app is upfront that XIRR/realized for that lot will be
partial. Anywhere that fund's basis is shown afterward, it reads `cost unknown` in `--muted`
italic, never `฿0` (a zero would be a lie).

---

## 4. Editing & deleting — in place, anchors guarded

Selecting `Edit` in any event inspector turns its detail block into the same inline mono fields
as one-off entry — **edit happens where the event lives**, not in a new modal. `↵` saves, `esc`
reverts. A faint `↺ edited` mark and timestamp appear after; the ledger never hides that a row
was touched.

```
┌─ EDIT · SELL · K-EQUITY ──────────────────── 21 May 2026 ─┐
│   units −200.00   price ฿58.40   fee −฿35                  │
│   note  trimmed on rally|                                  │
│   Realized recomputes to ▲ +฿1,240 on save.               │
│                                  [ Cancel ]   [ Save ⏎ ]   │
└────────────────────────────────────────────────────────────┘
```

Editing shows the **downstream consequence inline** ("Realized recomputes to…") so the user sees
the projection move before committing — the ledger-derives-holdings spine made visible.

**Deleting a normal event** is a quiet confirm in the inspector ("Delete this buy? Your units and
average cost will recompute.") — honest about the projection rebuild, but low-friction.

**Deleting a Starting balance is guarded** — it is the floor everything stands on:

```
┌────────────  lock  DELETE STARTING BALANCE  ───────────────┐
│                                                             │
│   GLOBAL-X · 96 units as of 31 Dec 2025                     │
│                                                             │
│   This is the foundation of everything after it.            │
│   Removing it recomputes this fund from scratch:            │
│                                                             │
│     units      96.00  →  18.30        (only later buys)     │
│     avg cost   ฿37.50 →  ฿41.10                             │
│     realized   ▲+฿1,240 unchanged · basis history redrawn   │
│                                                             │
│   3 later events will be re-based on the new floor.         │
│                                                             │
│   Type DELETE to confirm   ┌ ________ ┐                     │
│                                                             │
│                    [ Cancel ]   [ Delete & recompute ]      │
└─────────────────────────────────────────────────────────────┘
```

The guard's whole job is to **show the recompute as a concrete before→after**, not just warn.
A type-to-confirm gate, the `lock` glyph, and a literal preview of how units/avg-cost/basis shift.
You can't delete the floor by reflex.

---

## 5. The Portfolio home — "how's my money?" before any row

The home answers the glance question in the **first band**, then teases the register beneath it.
Calm by default; depth is one tap down.

```
┌  macrotide                                       ⌘K ⊕   user  ┐
│                                                               │
│   TOTAL VALUE                                                 │
│   ฿1,284,500                                                  │
│   ▲ +฿42,180  (+3.4%)  today        ▲ +฿182,400  all time     │
│   ───────────────────────────────────────────────────────────│
│   INVESTED ฿1,102,100   ·   XIRR +9.2%/yr   ·   REALIZED ▲+฿18,420 │
│                                                               │
│   ░░░░░░░░░░░░░░░░░░░░░▁▂▃▄▆█  value vs invested · 12mo  ──›   │
│   ═══════════════════════════════════════════════════════════│
│                                                               │
│   POSITIONS                                  value      P/L    │
│   ───────────────────────────────────────────────────────────│
│   EXAMPLE-FUND-A    1,412.5 u   ฿34,197   ▲ +฿4,210  +14.0% › │
│   K-EQUITY            220.0 u   ฿12,848   ▲ +฿1,520  +13.4% › │
│   SCBSET            1,200.0 u   ฿18,360   ▼ −฿640    −3.4%  › │
│   GLOBAL-X            114.3 u    ฿4,693   cost unknown      › │
│   K-FIXED-A         2,000.0 u   ฿20,400   ▲ +฿180    +0.9%  › │
│   ───────────────────────────────────────────────────────────│
│                                                               │
│   RECENT                                          see all ›   │
│   04 Jun  BUY   EXAMPLE-FUND-A   +412.5   −฿9,987            │
│   28 May  DIV   EXAMPLE-FUND-A      —     +฿1,204            │
│   21 May  SELL  K-EQUITY         −200.0  +฿11,680  ▲+1,240   │
│                                                               │
│  ─────────────────────────────────────────────────────────── │
│   home    chart    chat    insight    user                    │
└───────────────────────────────────────────────────────────────┘
```

- **The headline is a number, not a card.** `฿1,284,500` in large mono, with today + all-time
  deltas, then a thin secondary line carrying `INVESTED / XIRR / REALIZED`. The whole "how's my
  money?" answer is the top ~120px and readable before any row.
- **The value-vs-invested sparkline** is the only chart on home — a glance at the gap between
  what you put in and what it's worth. Tap → opens the full performance view. Depth on demand.
- **POSITIONS is the ledger summed** — the same Position Line, sorted by value. P/L right-aligned,
  signed, colored. `cost unknown` shows honestly instead of a fake P/L. Tap any → position page.
- **RECENT teases the register** with three events in the exact register format, then `see all ›`
  → the Activity screen. The home literally previews the deeper surface in its own visual
  language, so descending feels like zooming, not switching apps.

---

## 6. The single-position page — summary on top of the history that made it

The clean-room hinge: a fund's **running summary sits directly on the events that produced it.**
One screen, no seam. You reach it by tapping any position anywhere.

```
┌ ‹ Portfolio                  EXAMPLE-FUND-A                  ⊕ ┐
│  Example Global Equity Fund A                                  │
│                                                               │
│   VALUE ฿34,197      ▲ +฿4,210  (+14.0%)                       │
│   1,412.5 units  ·  avg cost ฿21.20  ·  XIRR +11.8%/yr         │
│   ───────────────────────────────────────────────────────────│
│   ┌─ cost basis vs market value · since start ──────────────┐ │
│   │                                          ╭───── ฿34,197  │ │
│   │  value  ▁▂▃▃▄▅▅▆▇█  ╭──────╯                            │ │
│   │  basis  ▁▁▂▂▃▃▃▄▄▄▄▄▄  ───── ฿29,940 (cost)              │ │
│   │  ⌂ start                              gap = unrealized   │ │
│   └───────────────────────────────────────────────────────────┘ │
│   Realized banked  ▲ +฿820     Income  ฿1,204     Fees ฿70    │
│   ═══════════════════════════════════════════════════════════│
│                                                               │
│   HISTORY                                    [All ▾] [⊙]      │
│   04 Jun   BUY    +412.50   ฿24.21   −฿9,987            ›     │
│   28 May   DIV       —        —      +฿1,204            ›     │
│   12 Mar   BUY    +300.00   ฿19.80   −฿5,940            ›     │
│   08 Jan   BUY    +700.00   ฿18.10   −฿12,670           ›     │
│   ─────────────────────────────────────────────────────────  │
│   ⌂ START  1,000.00 u · 31 Dec 2025 · cost ฿18,000     ›     │
└───────────────────────────────────────────────────────────────┘
```

- **The summary band is per-fund analytics in context** — `marketValue`, `units`, `avg cost`,
  per-fund `irr`, and below the chart the `realizedTotal` / `incomeTotal` / `expenseTotal` for
  *this fund*. Each number sits beside the history that explains it. Realized gain lives here too,
  because this is where the sells that banked it live.
- **The cost-basis-vs-value chart** is the page's signature: two SVG series — `basisTimeline`
  (area, `--line-soft`) and `marketValue` (line, `--accent`) — and the **gap between them is
  unrealized gain, made literally visible.** The `⌂ start` marker anchors the left edge so you
  see exactly where tracking began. Stepped basis line visibly jumps on each buy.
- **The same register, scoped.** The history below is the identical row format from the
  portfolio Register — just filtered to this instrument. The Starting balance anchors the bottom
  as the floor. Instrument column is dropped (redundant), gaining width for notes on expand.
- `⊕` on this page pre-fills Record with this instrument selected — recording more activity for a
  fund you're already looking at.

---

## 7. Every state

```
EMPTY / FIRST-RUN ─────────────────────────────────────────
┌───────────────────────────────────────────────────────────┐
│            Let's bring your portfolio in.                  │
│                                                            │
│   Photograph your broker's holdings screen, paste a        │
│   statement, or add one fund by hand. macrotide reads      │
│   it and shows you what it found before saving anything.   │
│                                                            │
│        [ ⤓ Import a statement ]   [ + Add one fund ]       │
│                                                            │
│   No demo numbers, no fake portfolio — your register       │
│   starts the moment you record your first event.           │
└────────────────────────────────────────────────────────────┘
```
One confident instruction, two doors, both into §3. No skeleton pretending to be data.

```
LOADING ───────────────────────────────────────────────────
  EXAMPLE-FUND-A   1,412.5 u   ░░░░░░░   ░░░░░░     ›
  K-EQUITY           220.0 u   ░░░░░░░   ░░░░░░     ›
  (the register skeleton keeps its exact column grid; only the
   value/price cells shimmer in --line-soft. Structure never reflows.)
```

```
COST UNKNOWN ──────────────────────────────────────────────
  GLOBAL-X   114.3 u   ฿4,693   cost unknown   ›
  → P/L cell reads "cost unknown" in --muted italic, never ฿0.
    Inspector offers: [ Add the cost I paid ] to upgrade the lot.
```

```
RETURN NOT AVAILABLE YET ──────────────────────────────────
  XIRR   —  not enough history yet
  → Below ~28 days of activity, XIRR shows a short human reason,
    never a bare dash: "We can measure return once there's about
    a month of activity to learn from." (in --muted, sits where
    the % would be.)
```

```
PRICE UNAVAILABLE ─────────────────────────────────────────
  SCBSET   1,200.0 u   ฿—  price unavailable   refresh↻   ›
  → marketValue null: value cell shows "฿— price unavailable"
    in --amber, with a refresh affordance. Position still counts
    its units & cost; only the live mark is missing. Total Value
    on home appends "· 1 price pending" rather than under-reporting.
```

```
ERROR (import / save) ─────────────────────────────────────
┌───────────────────────────────────────────────────────────┐
│  amber  We couldn't read that screenshot clearly.          │
│  The text was too small or cropped. Try a fuller shot,     │
│  paste the numbers as text, or add the fund by hand.       │
│              [ Try another image ]   [ Enter by hand ]      │
└────────────────────────────────────────────────────────────┘
  → Errors always offer a path forward, never a dead end.
    Nothing is half-written: a failed import commits zero rows.
```

Every state holds the column grid and the calm voice. Failure is informative, not loud.

---

## Component inventory

The whole system is assembled from a small, ruthlessly reused kit:

- **Register** — the 12-col mono grid (date · kind · instrument · units · price · amount · gain ·
  expand). The single most-reused component; renders portfolio-wide, scoped-to-fund, recent-tease,
  and import-preview identically.
- **EventRow** — one ledger atom inside the Register; variant by `kind` (sign, color, field set);
  carries the realized-gain trailer on sells and the full-width statement form on anchors.
- **AnchorRow** — the italic full-width Starting balance / Restatement line; visually *other*.
- **Inspector** — right rail (desktop) / bottom sheet (mobile); shows expanded event, hosts
  inline Edit, and is the home for the SELL cost→realized derivation.
- **PositionLine** — the summed-ledger row (instrument · units · value · P/L); home positions list.
- **StatStrip** — the pinned mono trio (realized / invested / income) that re-scopes to context.
- **Headline** — the big mono number + delta lines; the "how's my money?" answer block.
- **DualSeriesChart** — SVG basis-area + value-line with start marker and unrealized gap; plus the
  home value-vs-invested **Sparkline** variant and the monthly-net **MicroBar**.
- **RecordOverlay** — the one-door capture surface (drop zone + inline one-off row).
- **ClassifierVerdict** — the plain-language "what we read" panel + one-tap flip.
- **ConfirmTable** — the fully inline-editable import grid with amber per-row flags.
- **CostBasisToggle** — the "I know / I don't know what I paid" control in Starting balance.
- **DeleteGuard** — the type-to-confirm before→after recompute panel for anchors.
- **FilterChips** — mono segment chips + the thin `[⊙]` facet row.
- **MonoMoney / MonoUnits / KindTag** — the typographic primitives; signed, colored, aligned.

---

## Motion & transition

Motion is **structural, not decorative** — it explains the ledger-derives-holdings spine and
otherwise gets out of the way. Zooming between altitudes (home → position → event) is a shared
register: the tapped row stays put and the surrounding rows part to reveal detail, so you feel you
*dove into the same object*, never that a new page slid in (120–160ms, ease-out, no bounce). The
inspector cross-fades content rather than sliding a panel. When a write lands, the affected number
**counts to its new value** in ~250ms and the recomputed cells flash a one-frame `--accent` hairline
underline — the projection visibly settling so you trust that holdings followed the ledger. Anchor
deletes ripple the recompute top-down through the dependent rows so the cascade is legible, not
instantaneous. Loading shimmers stay within the exact column grid — structure never reflows, only
fills. Everything is quiet, fast, and in service of *the user believing the numbers*. No spring
overshoot, no parallax, no celebration animations: this is an instrument, and instruments are
steady.
