# Add to portfolio — Design B: "One grid that reflows to cards"

**Lens: Adaptive data surface.** The review table is a real input **grid** on
desktop (`.txn-row` / `.manual-row`), built for entering and scanning many rows
fast — tab from cell to cell, same as the existing bulk importer. On mobile the
*same rows* collapse to stacked input **cards**, one field per line. Identical
data model, identical field components; only the layout reflows.

---

## 1. The core mechanism

One review surface holds a list of rows; each row carries a **Type** that is the
only per-row mode. Type is a `.type-badge`-style select sitting in the second
grid column (mirroring `.txn-row`'s `124px 98px …` layout, where `98px` is the
Type cell). When a row's Type is **Starting balance**, the grid **disables** its
Date and Amount cells (rendered muted, non-tabbable) and **relabels** the Price
cell to "Avg cost" — so a snapshot anchor and a ledger trade live in one table
without a top-level mode switch. **Buy / Sell / Dividend / Fee / Split /
Reinvest** rows show the full cell set. Rows of different Type mix freely and
save together; each routes by its Type to `POST /api/transactions` (anchor vs
trade delta). Auto-detect from intake sets the initial Type per row; the user
only ever corrects the odd one.

---

## 2. Desktop — annotated ASCII mockup (review state)

Native frame: `.modal--txnwide` (`max-width: 880px`), `.modal-header` /
`.modal-body` / `.modal-footer`. The body holds a column-header rule + one
`.txn-row` grid per row (wide template:
`124px 98px minmax(110px,1.4fr) 60px 60px 56px 82px 28px`).

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Add to portfolio                                                         (x)  │ ← .modal-header / .modal-title
│  3 rows ready · 1 starting balance, 2 trades                                   │ ← .modal-subtitle (live count)
├──────────────────────────────────────────────────────────────────────────────┤
│  ┌ Paste ─┬ Image ─┬ Type ─┐        [ Thai fund | Stock/ETF ]   ← .source-seg  │ ← .method-tabs (intake)
│  └────────┴────────┴───────┘                                                   │
│                                                                                │
│  DATE        TYPE      SYMBOL          UNITS   PRICE    FEE    AMOUNT        ⌫  │ ← column-header rule (mono, --muted)
│  ┌─────────┬────────┬──────────────┬───────┬───────┬──────┬──────────┬──────┐ │
│  │ ░░░░░░░░ │ Start ▾│ EXAMPLE-FUND │ 1,200 │ 24.50 │ ░░░░ │ ░░░░░░░░ │  🗑  │ │ ← .txn-row · Type=Starting balance
│  │  (date   │        │      -A   TH │       │ ↑avg  │      │ (derived)│      │ │   Date+Amount disabled (░), Price→"Avg cost"
│  │  off)    │        │              │       │ cost  │      │          │      │ │
│  ├─────────┼────────┼──────────────┼───────┼───────┼──────┼──────────┼──────┤ │
│  │ 12 Mar  │ Buy   ▾│ EXAMPLE-FUND │   100 │ 25.50 │  40  │  ฿2,590  │  🗑  │ │ ← .txn-row · Type=Buy (full set)
│  │ 2026    │        │      -A   TH │       │       │      │          │      │ │
│  ├─────────┼────────┼──────────────┼───────┼───────┼──────┼──────────┼──────┤ │
│  │ 28 May  │ Sell  ▾│ K-EQUITY  TH │    50 │ 31.20 │  25  │  ฿1,535  │  🗑  │ │ ← .txn-row · Type=Sell
│  │ 2026    │        │              │       │       │      │  +฿285 ▲ │      │ │   realized gain in .delta.up under amount
│  └─────────┴────────┴──────────────┴───────┴───────┴──────┴──────────┴──────┘ │
│                                                                                │
│  + Add row                                                       ← .btn.link   │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  modal-body-sentinel    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                        [ Cancel ]   [ Add 3 to portfolio ]     │ ← .modal-footer-end · ghost + primary
└──────────────────────────────────────────────────────────────────────────────┘
```

Annotations: the `TH` chip is the `.type-badge` (asset-class hint, not a
provider). `░` cells are disabled — `var(--muted)`, `opacity .7`, `tabIndex=-1`.
Tab order runs left-to-right then down, skipping disabled cells, so a trade row
is six tabs and an anchor row is three. The `.source-seg` is a *bulk* helper
(sets every row's `quote_source` at once) — it is not a mode and never gates what
Types you can enter.

---

## 3. Mobile — annotated ASCII mockup (same surface, bottom sheet)

Native frame: full-bleed bottom sheet (the Modal primitive's mobile form). The
column header rule is **dropped**; each `.txn-row` reflows from a single grid
line into a **stacked card** — the existing narrow `.txn-row` template
(`repeat(12,1fr)` with per-column placement) taken to its limit: one field per
line, label on the left. Same inputs, same Type select, same disabled logic.

```
╭──────────────────────────────────────────────╮
│  ───                                          │ ← grabber
│  Add to portfolio                        (x)  │ ← .modal-header
│  3 rows ready                                 │ ← .modal-subtitle
├──────────────────────────────────────────────┤
│  ┌ Paste ─┬ Image ─┬ Type ─┐    ← .method-tabs│
│  └────────┴────────┴───────┘                  │
│                                               │
│  ┌──────────────────────────────────────────┐│ ← .txn-row as a card (.card-soft frame)
│  │ Type     [ Starting balance        ▾ ]   ││   Type select first — it sets the shape
│  │ Symbol   [ EXAMPLE-FUND-A        TH ]     ││
│  │ Units    [ 1,200 ]                        ││
│  │ Avg cost [ 24.50 ]      ← Price relabeled ││
│  │ ░ Date and Amount hidden for this Type    ││   (collapsed, not greyed — saves height)
│  │                                      🗑    ││
│  └──────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────┐│
│  │ Type     [ Buy                     ▾ ]    ││
│  │ Date     [ 12 Mar 2026 ]                  ││
│  │ Symbol   [ EXAMPLE-FUND-A        TH ]     ││
│  │ Units [ 100 ]   Price [ 25.50 ]  ← paired ││   two short fields share a line
│  │ Fee   [ 40 ]    Amount  ฿2,590            ││   Amount derived, mono, read-only
│  │                                      🗑    ││
│  └──────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────┐│
│  │ Type     [ Sell                    ▾ ]    ││
│  │ … K-EQUITY · 50 · ฿31.20 · +฿285 ▲        ││   .delta.up for realized gain
│  └──────────────────────────────────────────┘│
│                                               │
│  [ + Add row ]                  ← .btn.ghost  │
├──────────────────────────────────────────────┤
│  [ Add 3 to portfolio ]      ← .btn.primary   │ ← .modal-footer, .btn.full
│  [ Cancel ]                     .full         │
╰──────────────────────────────────────────────╯
```

**Shared vs different.** Shared: every field input (`.sheet-input`), the Type
select, the `.type-badge`, the disabled/relabel rules, the intake `.method-tabs`,
the live count, and the footer buttons. Different: desktop renders rows as a
multi-column grid under one column-header rule; mobile renders each row as a
stacked `.card-soft` card with per-field labels and **hides** (rather than greys)
the Type's irrelevant cells to save vertical space. The footer goes
`.btn.full` stacked on mobile, inline `ghost + primary` on desktop. Nothing
about the data model or the per-row Type changes between them.

---

## 4. The intake — paste / image / type (no confusing segment)

One `.method-tabs` strip with three options — **Paste · Image · Type** — labelled
by *how you bring data in*, not *what kind it is*. There is **no**
holdings-vs-history second control; the brief's rejected "two stacked segments"
collapse to this single intake strip.

- **Paste** → a `.sheet-input` textarea (mono). On paste, lines are parsed into
  rows that drop straight into the grid below.
- **Image** → a `.drop-zone` ("Drag & drop a screenshot / or click to browse");
  OCR yields the same rows.
- **Type** → the grid starts with one empty `.txn-row` and `+ Add row` appends
  more.

However the rows arrive, they land in the **same grid** and **auto-detect** sets
each row's Type: a dated buy/sell token → that trade type; a bare symbol +
quantity → **Starting balance**. The user sees a populated grid, not a
"snapshot or transactions?" question.

---

## 5. Editing a row & changing its Type

Editing is **in-place** — every cell is a live `.sheet-input`, exactly as the
existing `.txn-row` / `.manual-row` importer works (no separate `.ledger-edit`
detail pop-up needed for the common case; the grid *is* the editor). To change a
row's Type, open the **Type select** (the `.type-badge` cell). Picking a new
Type re-runs the same disabled/relabel logic the auto-detector used:

- → **Starting balance**: Date + Amount cells disable (desktop: greyed,
  non-tabbable; mobile: collapse); Price cell relabels to **Avg cost**; the
  gutter intent becomes the `▸` anchor mark.
- → **Buy / Sell / …**: all cells re-enable; Price reverts to "Price"; Amount
  resumes deriving from `units × price (± fee)`.

Because Type drives only enable/label state on a fixed cell set — not a different
form — switching Type never loses already-entered Symbol/Units values. For a
single-row deep edit (e.g. fixing a fee on one event), the row can expand into
the native `.ledger-edit` inline editor; the grid cell values bind to the same
fields, so it's the same record either way.

---

## 6. Empty / first-run, and cost-unknown

**Empty / first-run.** Body opens on the intake strip plus the empty-state card
(`.card`, centered): a small icon, "Add your holdings or trades", one line —
"Paste a statement, drop a screenshot, or add rows by hand. We'll sort snapshots
from transactions for you." — and a single `.btn.primary` "+ Add first row". No
mode to pick; the empty grid already has one Starting-balance row primed (the
most common first action is recording what you currently hold).

**Cost-unknown starting balance.** Avg cost is **optional**. Leaving it blank is
valid — the row saves as an anchor without cost basis. The blank cell shows a
muted placeholder "—", and a single `var(--amber)` note rides under the row
(mirroring `.evline-anchor__note` "cost basis not recorded"): *"No cost basis —
gains will track from today."* No error, no block; the footer's
"Add N to portfolio" stays enabled.

---

## 7. Shared-component table

| Component (native class) | Role in this modal | Reused mobile ↔ desktop? |
| --- | --- | --- |
| `.modal` + Header/Body/Footer | Shell — `.modal--txnwide` desktop, full-bleed sheet mobile | Frame shared; width/anchor differ |
| `.modal-title` / `.modal-subtitle` | "Add to portfolio" + live row count | Shared |
| `.method-tabs` | Intake: Paste · Image · Type | Shared |
| `.sheet-input` (textarea variant) | Paste box | Shared |
| `.drop-zone` | Image / OCR intake | Shared |
| `.txn-row` (grid) | One row of the review surface | **Same component**; grid→stacked via its wide/narrow templates |
| `.sheet-input` (cell) | Every editable cell (Date/Symbol/Units/Price/Fee) | Shared |
| Type select + `.type-badge` | The per-row Type (the only mode) | Shared |
| `.source-seg` | Bulk `quote_source` setter (Thai fund / Stock-ETF) | Shared (desktop inline, mobile under tabs) |
| `.delta.up` / `.delta.down` | Realized gain/loss under a Sell amount | Shared |
| `var(--amber)` note (`.evline-anchor__note` style) | Cost-unknown anchor hint | Shared |
| `.card` empty state | First-run | Shared |
| `.btn.link` / `.btn.ghost` | "+ Add row" | Shared (ghost full-width on mobile) |
| `.btn.primary` + `.modal-footer-end` | "Add N to portfolio" | Shared; `.btn.full` stack on mobile |
| `.icon-btn.quiet` | Row remove (🗑) + close (x) | Shared |

The only platform-specific logic is **layout reflow** (grid columns vs stacked
card) and the disabled-cell treatment (grey vs collapse) — both pure CSS off the
existing `.txn-row` wide/narrow templates. Data model, field components, Type
logic, and routing are identical.

---

## 8. Cognitive-load tactics

1. **Detection classifies; the user corrects.** Auto-detect sets each row's Type
   from the intake, so "snapshot vs transaction" is a per-row label the user
   rarely touches — never an upfront fork. One intake, no mode picker.
2. **Type shapes the row, so you only see relevant fields.** A Starting-balance
   row hides/greys Date + Amount and relabels Price → Avg cost; a trade shows the
   full set. Progressive disclosure happens per row, automatically — you never
   stare at cells that don't apply.
3. **Derived fields, not asked fields.** Amount computes from `units × price (±
   fee)` (read-only mono); realized gain shows itself on a Sell. The user types
   the few facts they know and the grid fills the rest.
4. **Forgiving anchors.** Avg cost is optional with a calm amber note, not an
   error — recording "what I hold" never gets blocked on a number the user may
   not have. The live subtitle count ("3 rows ready · 1 starting balance, 2
   trades") is the only running feedback they need before one Save.
