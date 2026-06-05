# Design brief — reimagine the "transactions / activity" experience in macrotide

You are a product designer. The owner of **macrotide** (a personal investing app for a
Thai retail investor) wants a **ground-up redesign** of how a user records and reviews
their buy/sell history. An implementation already exists; the owner is **not happy with
it** and wants something designed **from first principles, NOT derived from the current
UI**. Treat the existing code as "what exists today, to be replaced" — study it only so
you don't accidentally reinvent the same thing. Form your own opinion about the *right*
experience. Do not assume the current structure (modals, a Holdings/Activity toggle, a
data-entry grid) is correct — question all of it.

You will produce **ONE bold, coherent design direction** from your assigned lens. Another
designer is producing a different direction in parallel; the owner will compare and pick.
So commit hard to your point of view — don't hedge or produce a safe average.

---

## The product (context you must respect)

macrotide is a calm, editorial, "private wealth dashboard" feel — NOT a loud trading app.
It tracks mutual funds + ETFs + stocks for one investor, prices them in **THB (฿)**, and
has an AI **"Advisor"** the user can chat with. It is **read-only about money** — it never
executes trades; the user records what already happened at their broker.

**Voice (must follow in any copy you write):** formal and friendly, plain English over
jargon, no emojis. The AI is always called "Advisor" (never "bot"/"AI"/"assistant" in
running copy). Anchors like an opening position are called "Starting balance" /
"Restatement" to a retail user — never "opening"/"snapshot".

**Existing app shell:** a left/bottom nav with real full-page screens — Portfolio,
Markets, Explore, Advisor (chat), Journal. Plus a right-hand Advisor dock on desktop.
There is NO "Activity" or "Transactions" screen today — the feature lives entirely in
modals launched from the Portfolio screen's Holdings header. A redesign is free to
introduce a real screen/route, a panel, a drawer, an inline section, or stay a
modal — your call. Justify the form factor.

---

## What the user actually needs to do (the jobs)

1. **Record activity** — log a buy, sell, dividend, fee, split, or reinvestment. Often in
   bulk (paste a CSV / broker statement, or upload a screenshot that gets OCR'd into
   rows). Sometimes one-off. Also set a **starting balance** for a position they already
   held before they started tracking (with cost basis possibly unknown).
2. **Review history** — see what they've bought/sold over time, per fund and overall.
3. **Understand performance** — realized gains (this is money actually banked from sells),
   money-weighted return (XIRR — accounts for *when* cash went in), total invested /
   contribution timeline, cost basis over time.
4. **Fix mistakes** — edit or delete a past entry; deleting a "starting balance"
   recomputes everything downstream, so it needs a guard.

The hard conceptual problem this feature exists to solve: **a position you hold and the
history of how you got there are the same underlying truth.** In this app, holdings are a
*projection* of one transaction ledger — there is exactly one source of truth. Your design
should make that feel natural, not like two disconnected features.

---

## The data you have to work with (backend is FIXED — design to it, don't change it)

Each transaction row (the ledger): `tradeDate`, `kind`
(buy/sell/dividend/fee/split/reinvest, plus anchor kinds opening→"Starting balance",
snapshot→"Restatement"), `ticker`, `englishName`, `units`, `pricePerUnit`, signed THB
`amount`, `fee`, `source` (broker label), `note`. Sells carry a **realized gain**.

Analytics available per scope (one portfolio or all): `realizedTotal`, `irr`
(money-weighted, null if <~28 days of activity — show why), `incomeTotal`, `expenseTotal`,
`contributions` (total invested + net-invested per month), `basisTimeline` (cost basis
over time), `marketValue` (current value of still-held units, may be null if unpriced),
per-position state. Charts are hand-rolled SVG in house style (a `Sparkline` exists).

Entry/OCR: a paste box parses CSV-ish text into rows; an image endpoint OCRs a broker
screenshot into rows. Both feed an editable confirmation step before saving.

---

## Visual system (your mockups should be buildable in this — don't invent a new theme)

Design tokens (CSS vars, light/dark both exist):
- Surfaces: `--bg` (app), `--paper` (cards), `--line` / `--line-soft` (borders)
- Text: `--ink` (primary), `--ink-soft`, `--muted`, `--muted-2`
- Brand/positive: `--accent` (#10a86b green), `--accent-2` (#0aa694 teal)
- Semantic: `--gain` (green), `--loss` (#d14545 red), `--amber` (#d89a1f warnings)
- Type: system sans for prose; `--font-mono` (Geist Mono) for numbers, dates, labels,
  tickers. Money is `฿1,234`. Labels are often small-caps mono with letter-spacing.
- Feel: generous whitespace, hairline borders, restrained color, numbers in mono. Calm.

Icon set available (named): home, chart, chat, insight, user, settings, send, sparkle,
arrowRight, arrowUp, arrowDown, plus, close, check, info, refresh, pulse, lock, book,
pencil, piggyBank, trend, bank, search.

---

## Your assigned lens

>>> LENS <<<

(Design entirely through this lens. Be true to it even if it leads somewhere unconventional.)

---

## Deliverable — return as Markdown (and ALSO write it to the path given in your task)

Structure your design doc exactly like this:

1. **Name & one-line pitch** — a memorable name for the direction + a single sentence.
2. **The core idea** (2–4 sentences) — the one insight your design is built on, and what
   you deliberately reject about the obvious approach.
3. **Form factor & where it lives** — screen / route / drawer / modal / inline, and why.
   How the user reaches it.
4. **The main view — ASCII mockup** — a real, fairly detailed ASCII wireframe (use box
   characters), annotated. Show the dominant state (has data). Use realistic THB numbers
   and Thai-ish fund tickers like `EXAMPLE-FUND-A`, `K-EQUITY`, `SCBSET` (generic — never
   a real fund the owner holds).
5. **Recording activity — ASCII mockup** — how add / bulk-import / OCR-confirm / set
   starting balance works in your design. This is half the feature; don't shortchange it.
6. **Editing & deleting** — the inline-edit / correction flow, and the starting-balance
   delete guard.
7. **How performance & realized gains surface** — where IRR, realized gain, invested,
   cost-basis-over-time live, and how you avoid clutter.
8. **Empty & first-run state** — what a new user with zero transactions sees.
9. **Responsive / mobile** — one short paragraph + a tiny mockup of the mobile form.
10. **Why this wins** — 3 bullets on what this direction does better than a generic
    dense-table-in-a-modal, and the 1 honest tradeoff it makes.

Keep it concrete and visual. Mockups are the deliverable — the owner decides from them.
Aim for ~700–1100 words plus the mockups. Be opinionated.
