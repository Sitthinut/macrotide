# Clean-room brief — redesign the "money record" UI from zero

You are a senior product designer. Design the COMPLETE UI for how a person records and
reviews their investing history in an app called **macrotide**. Design it **from first
principles**.

**HARD RULE — clean room.** Do **NOT** open, read, grep, or infer from any existing source
file in this repository (no `components/`, no current screens, no other design docs). An
earlier implementation exists and is considered *wrong/anchored*; seeing it would pollute
you. Design **only** from this brief. If you catch yourself reproducing an obvious
"transaction table in a dialog," stop and rethink — that is the exact thing being thrown
out.

---

## The product

macrotide is a calm, editorial **private-wealth dashboard** for one Thai retail investor —
not a loud trading app. It tracks mutual funds + ETFs + stocks, values everything in **THB
(฿)**, and has an AI called **"Advisor"**. It is **read-only about money**: it never places
trades — the user records what already happened at their broker. The feel is quiet,
confident, generous whitespace, hairline rules, numbers in mono, restrained color.

**Voice (use in any copy you write):** formal and friendly, plain English over jargon, no
emojis. The AI is always "Advisor." Never expose internal jargon like "opening balance" or
"snapshot" — a position the user held before they started tracking is a **"Starting
balance"**; a correction to a running balance is a **"Restatement."**

---

## The jobs to be done

1. **Record activity** — log a buy, sell, dividend, fee, split, or reinvestment. Often in
   bulk (paste a CSV/broker statement, or upload a screenshot that gets read by OCR).
   Sometimes one at a time. Also set a **Starting balance** for a fund held before tracking
   began (cost basis may be unknown).
2. **Review history** — see what was bought/sold over time, for the whole portfolio and per
   fund.
3. **Understand performance** — **realized gains** (money actually banked from sells),
   **money-weighted return (XIRR)** (accounts for *when* cash went in), **total invested /
   contribution timeline**, **cost basis over time**.
4. **Fix mistakes** — edit or delete a past entry. Deleting a Starting balance recomputes
   everything downstream, so it must be guarded.

**The conceptual spine (frozen — your design must make this feel natural):** there is **one
event ledger**, and it is the single source of truth. A user's **holdings are a *projection*
of that ledger** — derived, not separately stored. So **a position and the history of how
they got there are the same underlying thing.** A design that splits "what I hold" from "how
I got it" into two disconnected features is wrong.

---

## Settled principles (design WITHIN these — but invent all the actual UI yourself)

These are *requirements*, not layouts. How you realize them is entirely yours.

- **No "classify it yourself" toggle on import.** A newcomer just photographs their current
  broker screen. The app must figure out whether they brought a **current-holdings snapshot**
  (→ becomes Starting balances) or a **buy/sell history** (→ becomes activity), tell them in
  plain words, and let them correct it in one tap. Never force them to pick a mode before
  they understand the difference.
- **History is a real, reachable surface** — not buried in a transient dialog. And the user
  can move between the **whole-portfolio** view and a **single position's** history fluidly.
- **Calm by default, depth on demand.** The everyday read is a glance ("how's my money?");
  richer analysis (charts, full history, filters) is one deliberate step deeper, never dumped
  on screen at once.
- **Performance shown in context, not as an orphaned dashboard.** Realized gain belongs where
  it was banked; return/invested belong where they describe.
- **The Portfolio home should answer "how's my money?" before any row is read.**

---

## The data you have (backend is fixed; design to it)

One **event** (ledger row): `tradeDate`, `kind` ∈ {buy, sell, dividend, fee, split,
reinvest} plus the two anchors {Starting balance, Restatement}, `ticker` (e.g.
`EXAMPLE-FUND-A`, `K-EQUITY`, `SCBSET` — generic), optional `englishName`, `units`,
`pricePerUnit`, a signed THB `amount`, optional `fee`, optional `source` (broker label),
optional `note`. A **sell** carries a **realized gain**.

**Analytics, available scoped to the whole portfolio OR to a single fund:** `realizedTotal`,
money-weighted `irr` (null when <~28 days of activity — then a short human reason must be
shown, never a bare dash), `incomeTotal`, `expenseTotal`, `contributions` (total invested +
net-invested per month), `basisTimeline` (cost basis over time), `marketValue` (current value
of still-held units; may be null when a price is unavailable), per-position units/avg-cost.

**Import inputs:** pasted/CSV text, a photo/screenshot (OCR), and manual typing. There is an
"is this a transaction history vs a holdings snapshot?" classifier you can rely on.

---

## Visual system (your mockups must be buildable in this — don't invent a new theme)

CSS tokens, light + dark both exist:
- Surfaces: `--bg` (app), `--paper` (cards), `--line` / `--line-soft` (hairlines).
- Text: `--ink`, `--ink-soft`, `--muted`, `--muted-2`.
- Brand/positive: `--accent` (#10a86b green), `--accent-2` (#0aa694 teal).
- Semantic: `--gain` (green), `--loss` (#d14545 red), `--amber` (#d89a1f warnings).
- Type: system sans for prose; **mono (`--font-mono`)** for numbers, dates, labels, tickers.
  Money renders like `฿1,234`. Small-caps mono labels with letter-spacing are common.
- A hand-rolled **SVG chart/sparkline** capability exists (line + area + tiny bar series).
- Icons available by name: home, chart, chat, insight, user, settings, send, sparkle,
  arrowRight, arrowUp, arrowDown, plus, close, check, info, refresh, pulse, lock, book,
  pencil, piggyBank, trend, bank, search.

## Harness / form-factor constraints (so it's buildable — these are capabilities, not layouts)

- The app is a **client-side SPA**: you navigate between **full-screen "screens"** (the home,
  etc.) by state, and you can add new screens (including ones scoped to a single fund). Back
  navigation is a chevron in a top bar.
- **Overlay surfaces** are available: a centered panel on desktop that becomes a **full-bleed
  bottom sheet on mobile**; also inline expansion within a screen. Use whichever fits.
- Everything must be **fully responsive** (mobile-first is fine).

---

## Your assigned sensibility

>>> SENSIBILITY <<<

Commit hard to it. Make the whole system feel like one designer with a strong point of view —
not a committee average, and **not** a reskin of a generic ledger app.

---

## What to deliver (cover EVERY surface — this is "all affected UI, no exception")

A single, cohesive, opinionated UI design covering ALL of the following, each with a detailed
annotated **ASCII mockup** (use box characters; realistic ฿ numbers + generic tickers) plus a
few lines of interaction notes:

1. **The single event** — how one buy/sell/dividend/anchor is represented wherever events
   appear. This is your core atom; design it deliberately (what it shows, how it differs by
   kind, how a realized gain reads on a sell, how an anchor reads).
2. **The portfolio-wide history surface** — the full "everything that happened" view. Where it
   lives, how it's reached, grouping/sorting/filtering, and its dominant (has-data) state.
3. **Recording / importing** — the complete flow: one-off entry, bulk paste/CSV, photo/OCR,
   the **auto-detect snapshot-vs-activity** moment + plain-language confirm, the editable
   confirmation step, and **setting a Starting balance** (with cost-unknown handling).
4. **Editing & deleting** an existing event in place, and the **Starting-balance delete
   guard**.
5. **The Portfolio home integration** — the at-a-glance headline ("how's my money?"), how
   recent activity teases, and how the user gets into history and into a single position.
6. **The single-position page** — a fund's running summary above the history that produced it,
   with its cost-basis-vs-value chart and per-fund return.
7. **Every state** — empty / first-run, loading, cost-unknown, return-not-available-yet,
   price-unavailable, and error.

Also include: a short **component inventory** (the reusable pieces your system is built from)
and one paragraph on **motion/transition** feel.

Aim for depth and originality over length padding. ~1800–2800 words + the mockups. Be bold.
