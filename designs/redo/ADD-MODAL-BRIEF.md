# Brief — the unified "Add to portfolio" modal

Design ONE "Add to portfolio" modal for the **macrotide** app that handles BOTH a
current-holdings **snapshot** AND **buy/sell transactions**, with **NO top-level
holdings/history mode or segment control.** The snapshot-vs-transaction distinction must
live **per row** (a Type), never as a mode the user picks up front.

## Must use the existing design system — do NOT invent a new aesthetic
Read `designs/DESIGN-SYSTEM.md` (in this worktree) and compose ONLY from the app's native
primitives: the Modal primitive (centered panel on desktop / **full-bleed bottom sheet on
mobile**), `.holding` rows (`.swatch`/`.name`/`.sub`/`.value`/`.pct .delta`), `.ledger-edit`
inline editor, `.manual-row` / `.txn-row` input grids, `.stats-strip`, `.sheet-input`,
`.method-tabs`, `.chip`, `.btn`, `.drop-zone`, tokens (`--ink`/`--muted`/`--line`/`--accent`/
`--gain`/`--loss`/`--amber`/`--card-soft`, `--font-mono`). It must look like it was always
part of the app. (An earlier bespoke "editorial" redesign was rejected for clashing.)

## What the modal does
- **Inputs (one intake, not a mode picker):** paste / CSV, image / OCR screenshot, manual
  "+ add row". These are *how you bring data*, not *what kind it is*.
- **One review table.** Each row has a **Type** that spans BOTH worlds:
  - **Starting balance** (snapshot → an opening anchor): Symbol · Units · Avg cost (optional/unknown OK).
  - **Buy / Sell / Dividend / Fee / Split / Reinvest** (activity → a ledger event): Date · Type · Symbol · Units · Price · Amount · Fee.
  - Rows of different Type can be **mixed** in one save.
- **Auto-detect sets each row's Type** from the input (dated buy/sell tokens → that trade
  type; bare symbol + quantity → Starting balance). The user can change any row's Type. The
  user should rarely need to think about "snapshot vs transaction" — detection does it.
- **One save** → `POST /api/transactions` (already accepts opening anchors AND trade deltas);
  each row routes by its Type.

## Owner preferences
Likes the original Add-holding modal and its **narrow** size; dislikes the current TWO
stacked segment controls (holdings/history + paste/image). Wants snapshot + transactions in
one coherent surface.

## Hard requirements (the point of this brief)
1. **Responsive & native on BOTH platforms** — a real centered modal on desktop, a real
   full-bleed bottom sheet on mobile, each feeling native (not one squeezed into the other).
2. **Share UI elements across platforms as much as possible** — same components, layout
   adapts. Call out explicitly which pieces are shared vs. platform-specific.
3. **Minimize cognitive load** — smart defaults, progressive disclosure, let detection do the
   classifying; never show more than the user needs at each step.

## Your lens
>>> LENS <<<

## Deliver (Markdown)
A concrete, buildable unified Add-modal design:
1. **The core mechanism** — how one surface holds both kinds (the per-row Type), in 3–5 sentences.
2. **Desktop — annotated ASCII mockup** (the review state, with a couple of mixed rows: a
   Starting balance + a Buy + a Sell). Realistic ฿ + generic tickers (EXAMPLE-FUND-A, K-EQUITY).
3. **Mobile — annotated ASCII mockup** of the SAME surface as a bottom sheet, showing how it
   adapts (and what's shared vs different).
4. **The intake** — paste / image / type without a confusing segment; how rows + their Types appear.
5. **Editing a row & changing its Type** — the inline mechanism (native `.ledger-edit`).
6. **Empty / first-run**, and the **cost-unknown** starting-balance case.
7. **Shared-component table** — which native components compose it, and which are reused
   mobile↔desktop.
8. **Cognitive-load tactics** — the 3–4 concrete things that keep it simple.
Keep it ~800–1200 words + mockups. Compose from the system; don't invent CSS.
