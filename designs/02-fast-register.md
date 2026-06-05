# 02 — The Register

## 1. Name & one-line pitch

**The Register** — a full-screen, keyboard-first ledger where recording activity feels like editing a spreadsheet and reviewing it feels like reading a beautifully typeset book.

## 2. The core idea

A serious ledger is not a form you fill out one transaction at a time — it is a *living register* you live inside, the way you live inside an inbox. The single insight: **the entry surface and the review surface are the same surface.** The top row of the register is always a live quick-add; every row below it is the history, and every cell in that history is editable in place by clicking or tabbing into it — no pencil icon, no "edit mode," no second modal. I deliberately reject the current pattern (a modal, a pencil-per-row, a *separate* bulk-import sheet, charts bolted to the top) because it makes a heavy ledger feel like a settings dialog. Density, keyboard flow, and instant filter are the whole product here; analytics are a quiet sidebar, not the headline.

## 3. Form factor & where it lives

A **real full-page route: `/activity`**, added to the left/bottom nav between Portfolio and Markets (icon: `book`). It is *not* a modal — a modal caps height, fights the keyboard, and signals "occasional task." A ledger you'll scan hundreds of rows in over years deserves a room of its own.

Reached three ways: (1) the nav item; (2) clicking any holding row on Portfolio deep-links to `/activity?ticker=K-EQUITY` (pre-filtered — holdings are a *projection* of this ledger, so the link is literal, not metaphorical); (3) a global **⌘K → "Add transaction"** that lands focus in the quick-add row. The Advisor dock stays docked on the right; the register owns the center.

## 4. The main view — ASCII mockup

The dominant state: lots of data, the quick-add bar pinned at top, a command/filter bar, a dense-but-airy ledger, and a collapsed analytics rail.

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  Activity                                              All portfolios ▾   ⌘K Search   │
│  One ledger. Your holdings are derived from it.                                       │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ╔═══════════════════════════════════════════════════════════════════════════════════╗│  ← quick-add row
│ ║ + 2026-06-04 │ Buy ▾ │ K-EQUITY___ │ 500 units │ ฿24.10 │ fee ฿0 │ ฿12,050 │  ⏎ Add ║│    (always focused-ready,
│ ╚═══════════════════════════════════════════════════════════════════════════════════╝│     mono inputs, tab L→R)
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Filter: [ All types ▾ ] [ All sources ▾ ]   Search ticker…        ▢ Group by month  │  ← instant filter bar
├──────────┬────────┬───────────────────┬──────────┬─────────┬───────────┬─────────────┤
│ DATE     │ TYPE   │ SYMBOL            │  UNITS   │  PRICE  │   AMOUNT  │  REALIZED    │  ← sortable headers
├──────────┼────────┼───────────────────┼──────────┼─────────┼───────────┼─────────────┤
│ ▸ JUNE 2026                                                          6 entries · ฿—   │  ← month divider (collapsible)
│ 2026-06-03│ ●Buy   │ SCBSET            │   1,200  │  ฿18.40 │  ฿22,080  │      —       │
│ 2026-06-01│ ◆Div   │ K-EQUITY         │     —    │    —    │   +฿1,340 │      —       │
│ 2026-05-28│ ▼Sell  │ EXAMPLE-FUND-A   │     800  │  ฿31.75 │  ฿25,400  │   +฿3,120 ▲  │  ← realized green
│ 2026-05-22│ ●Buy   │ EXAMPLE-FUND-A   │   2,000  │  ฿11.20 │  ฿22,400  │      —       │
│ 2026-05-14│ ⌂Start │ K-EQUITY         │   5,000  │ ฿19.00¹ │ (anchor)  │   Starting   │  ← anchor row, tinted
│ 2026-05-09│ ▼Sell  │ SCBSET           │     300  │  ฿17.10 │   ฿5,130  │    −฿410 ▼   │  ← realized red
│ ▸ APRIL 2026                                                       11 entries · ฿—    │
│ …                                                                                     │
├──────────┴────────┴───────────────────┴──────────┴─────────┴───────────┴─────────────┤
│  ¹ avg cost on a Starting balance — gains stay hidden if left blank.                  │
└─────────────────────────────────────────────────────────────────────────────────────┘
        ╭───────────────────────── analytics rail (collapsed pill, top-right) ─────────╮
        │  ⌃A  ฿+18,240 realized · 14.2% return · ฿412,000 invested   ↗ expand          │
        ╰──────────────────────────────────────────────────────────────────────────────╯
```

Density-with-taste: mono numerals, right-aligned amounts, hairline `--line-soft` rows, type shown as a tiny tinted glyph + word (●buy `--accent`, ▼sell `--loss`, ◆div, ⌂start `--accent-2`). Month dividers are quiet mono small-caps you can collapse with `▸`. Hover a row reveals nothing — no icon clutter; the row *is* the affordance. Sorting is a header click; "Group by month" is a toggle, not the only mode (turn it off and it's one flat, sortable stream — the power-user default).

**Keyboard model (the soul of it):** `↑/↓` move the row cursor, `Enter` opens the row into edit, `Tab` walks cells left-to-right, `Enter` commits and drops you onto the *next* row's same cell (spreadsheet muscle memory), `Esc` reverts the cell. `j/k` also navigate (vim). `x` toggles row-select; `⇧+click` range-selects.

## 5. Recording activity — ASCII mockup

Three on-ramps, **all into the same register**, never a separate sheet:

**(a) Quick-add (one-off).** The pinned top row. Type a date or leave today's, `Tab` through type → symbol (live autocomplete from your holdings, `· YOURS` tag) → units → price → fee → amount; `⏎ Add` (or just Enter) commits and the new row animates into the ledger while focus snaps back to a fresh quick-add. No modal ever opens.

**(b) Bulk paste / CSV / OCR — inline staging.** Hit `⌘V` anywhere on the page (or drag a screenshot / CSV onto it). Parsed rows stage *as pending rows at the top of the register itself*, visually flagged, so confirmation happens in context — you see them sitting above your real history, edit any cell, then commit the batch.

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  ▣ 7 rows pending — pasted from clipboard.   Source: [ Broker statement ▾ ]           │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│  │ ⚑ 2026-05-02│ Buy  │ K-EQUITY        │ 1,000 │ ฿19.40 │      │ ฿19,400  │  ✓ ok   │ │
│  │ ⚑ 2026-05-04│ Buy  │ SCBSET          │   500 │ ฿18.10 │      │ ฿ 9,050  │  ✓ ok   │ │
│  │ ⚑ 2026-05-06│ Sell │ EXAMPLE-FUND-A  │   ░░░ │ ฿32.00 │      │ ฿16,000  │ ⚠ units │ │  ← amber, needs a cell
│  │ … 4 more                                                                          │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
│            6 ready · 1 needs attention      [ Discard ]   [ Commit 6 rows  ⏎ ]         │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

The OCR path is identical — drop a screenshot, the rows appear in the same pending tray (provenance dot so you know it was read, not typed). One confirmation surface for all three on-ramps; the old "Add to portfolio" modal disappears entirely.

**(c) Starting balance (a position held before tracking).** It is a *type*, not a separate flow. In the quick-add type dropdown, below the trade types and a divider, sits **"Starting balance"** (and "Restatement"). Pick it and the row reshapes: amount cell becomes inert and reads `(anchor)`, the price cell relabels to **avg cost** with helper text *"Leave blank if unknown — gains stay hidden until you add it."* Same register, same row, no wizard.

## 6. Editing & deleting

**Editing is the default interaction, not a mode.** Click a cell (or `Enter` on a focused row) and it becomes an input in place — the row doesn't pop a modal, doesn't grow a toolbar. Tab through, commit with Enter. Because holdings are a projection, an edit silently rebuilds them; a tiny `↻ holdings updated` flashes in the analytics rail so the user feels the connection without a dialog.

**Deleting** uses **bulk-select + undo**, the spreadsheet way. `x` (or the leftmost checkbox) selects rows; a contextual action bar slides up:

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  3 selected      Change type ▾    Set source ▾      🗑 Delete            ✕ Clear      │
└─────────────────────────────────────────────────────────────────────────────────────┘
        … after delete …
┌──────────────────────────────────┐
│  3 transactions deleted.  ↩ Undo  │   ← toast, ~8s, restores the exact rows
└──────────────────────────────────┘
```

Ordinary deletes are *optimistic + undoable* — no confirm dialog, because undo is the safety net. **The one exception is a Starting balance / Restatement anchor:** deleting it re-bases every downstream position, so it intercepts with an in-app confirm (never native `confirm()`):

```
┌──────────────────────────────────────────────────────────┐
│  Delete the Starting balance for K-EQUITY?               │
│  Every position built on it will be recomputed.          │
│                              [ Cancel ]   [ Delete ]     │
└──────────────────────────────────────────────────────────┘
```

A mixed selection that includes an anchor surfaces the guard once, names the anchor(s), and lets the rest go through.

## 7. How performance & realized gains surface

Realized gain lives **inline, in its own right-most column**, only on sell rows — green `+฿3,120 ▲` / red `−฿410 ▼` — so banked money reads at a glance while you scan. That's the only analytic *in* the table.

Everything else — money-weighted return (XIRR), total invested, income/expense, cost-basis-over-time — lives in the **collapsed analytics rail**, a single pill at the page edge (`⌃A` to expand) that becomes a slim right column when opened:

```
╭──────────────── Performance ────────────────╮
│  REALIZED        ฿+18,240   ▲                │
│  RETURN (IRR)    14.2%   money-weighted      │
│  TOTAL INVESTED  ฿412,000                    │
│  INCOME          ฿6,180   · EXPENSE  ฿920    │
│  ┌── cost basis over time ──────────────┐    │
│  │      ╱‾‾‾‾╲___╱‾‾‾‾‾‾‾ (Sparkline)   │    │
│  └──────────────────────────────────────┘    │
│  ┌── net invested / month ───────────────┐   │
│  │  ▁▃▅▂▆▃▇  (Sparkline, bars)           │   │
│  └──────────────────────────────────────┘    │
│  Return needs ~28 days of activity to show.  │  ← shown only when null, with the why
╰──────────────────────────────────────────────╯
```

It honors the current scope filter — narrow to one ticker and the rail recomputes for that position. Default collapsed keeps the register the hero; charts are *available*, never imposed. (XIRR null-state explains itself, per the data contract.)

## 8. Empty & first-run state

No data = the register is still the frame, with the quick-add row live and an editorial empty body — invitational, not a dead-end:

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ ╔═══════════════════════════════════════════════════════════════════════════════════╗│
│ ║ + 2026-06-04 │ Buy ▾ │ Symbol…     │ Units │ Price │ fee │ ฿ Amount │   ⏎ Add      ║│
│ ╚═══════════════════════════════════════════════════════════════════════════════════╝│
│                                                                                       │
│                              [ book icon ]                                            │
│                Start your register.                                                   │
│   Record a buy above, paste a broker statement (⌘V), or drop a screenshot.            │
│   Your holdings, realized gains, and money-weighted return all build from here.       │
│                                                                                       │
│        [ Paste a statement ]    [ Set a starting balance ]                            │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

"Set a starting balance" is the explicit nudge for someone migrating an existing portfolio — it pre-selects that type in the quick-add row.

## 9. Responsive / mobile

On mobile the spreadsheet grid collapses to a single-column **stacked register**: each history entry is a compact card (date · type glyph · symbol on line one, amount + realized on line two), tap-to-expand into an inline editor. The pinned quick-add becomes a **sticky bottom "+ Add" bar** that opens a fast, one-screen native-input form (date, type, symbol, units, price, amount) — large tap targets, mono numerals, no wizard steps. Paste/OCR still works: paste detection and the camera button live at the top of that bottom sheet.

```
┌───────────────────────────┐
│ Activity      All ▾    ⌕  │
├───────────────────────────┤
│ 06-03  ●Buy   SCBSET      │
│        1,200 · ฿22,080    │
├───────────────────────────┤
│ 05-28  ▼Sell  EX-FUND-A   │
│        ฿25,400  +฿3,120 ▲ │
├───────────────────────────┤
│ 05-14  ⌂Start K-EQUITY    │
│        5,000 u · avg ฿19  │
├───────────────────────────┤
│   ⌃ Performance  ฿+18,240 │
╞═══════════════════════════╡
│  📷   ⌘V        +  Add     │ ← sticky bottom add bar
└───────────────────────────┘
```

## 10. Why this wins

- **It's the fastest thing to *enter*.** A pinned quick-add + tab-through cells + Enter-to-next-row means logging ten trades is ten Enters, not ten modal round-trips. A generic dense-table-in-a-modal still gatekeeps every entry behind an "Add" button and a pencil; the Register erases the boundary between reading and writing.
- **One surface for all three on-ramps.** Type, paste, or OCR all stage *in the same ledger* as a pending tray — no context-switch to a second sheet, no "where did my import go." Confirmation happens where the data will live.
- **It makes "holdings are a projection" felt, not explained.** A real `/activity` route that holdings deep-link into, plus the live `↻ holdings updated` pulse on every edit, turns the app's hardest concept into a visible cause-and-effect — there's manifestly one source of truth.

**The honest tradeoff:** this is a *power tool*, and power tools have a learning curve. The keyboard model, inline-everything editing, and undo-instead-of-confirm reward a returning user but can feel sparse or unguided to a first-timer who expected a friendly form with labels and a big Save button. I'm betting on a user who keeps a real ledger and will tab through it for years — and leaning on the editorial empty state and one-tap mobile form to carry the newcomer until the speed clicks.
