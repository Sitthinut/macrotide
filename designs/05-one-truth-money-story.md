# 05 — One Truth, told as a Money Story (FINAL spec)

> Synthesis of **04 One Truth** (architecture) + **01 Money Story** (feel), hardened by a
> 4-designer feedback round. This is the spec we build. Backend is FIXED — UI layer only.

## 0. Decision log (settled — do not relitigate)

- **One ledger is the truth; holdings are its projection.** No separate "Activity" feature,
  no Holdings↔Activity toggle (that toggle *was* the core confusion).
- **Three surfaces, one mental model — "Portfolio is home; zoom in to a fund, or out to all
  events":**
  - `/portfolio` — the calm glance (default screen). **No sub-tabs.**
  - `/portfolio/[ticker]` — zoom IN: a position's running total above its own ledger.
  - `/portfolio/activity` — zoom OUT: the full, filterable cross-fund activity feed,
    reached via "See all activity →". A push/detail view, not a resident tab.
- **The headline number is never behind a tab** — it leads the default screen.
- **Recording is one smart sheet** that auto-detects snapshot (current holdings → starting
  balances) vs activity (buy/sell history), no mode toggle.
- **Events render as friendly cards** (the 01 feel), never a data-entry grid.
- **#35 backtest / #36 planner are NOT reserved inside the activity surfaces** — they deep-
  link out (likely Explore / the Plan area) when built. Activity stays clean.

## 1. The thesis — three pains, three fixes

1. *"Holdings vs Activity confuses."* → one ledger, made visible: a holding's summary sits
   directly above the events it derives from (drill-in). No competing "Activity" feature.
2. *"Weak hierarchy / not delightful."* → headline-first, card-based, calm-by-default (01).
3. *"Information overload."* → progressive disclosure everywhere; the heavy full feed lives
   on its own route, not stacked on the glance; import auto-classifies so the user never
   has to.

## 2. Information architecture

```
/portfolio              DEFAULT calm glance — headline · Trends(disclosure) · holdings · Recently peek
   │  ├─ tap a holding  → /portfolio/[ticker]   (zoom in: running total + that fund's ledger)
   │  └─ "See all       → /portfolio/activity   (zoom out: full filterable cross-fund feed)
   │      activity →"
   └─ [ + Add ]         → RecordSheet (auto-detect snapshot vs activity; contextual fund)
```

No new top-level nav item (mobile nav is at its 5-item ceiling). `/portfolio/activity` and
`/portfolio/[ticker]` are push/detail views reached by links — bookmarkable, never
permanently mounted. Recording is contextual: `+ Record` on a position page pre-binds that
fund; `+ Add` on the glance is where you pick fund(s) / bulk-import.

**Retired:** `AddToPortfolioSheet`, `AddTransactionsSheet`, `ActivityModal`, and the
Holdings-header "Activity"/"Import" buttons (→ one `+ Add`).

## 3. `/portfolio` — the default calm glance (01's main view, compressed)

Three bands top-to-bottom answer the three everyday questions: *how's my money?* → *what do
I hold?* → *what just happened?* Nothing heavy is on by default.

```
┌─ Portfolio ───────────────────────────────────────────────────  [ + Add ] ─┐
│                                                                             │
│   YOUR MONEY                                                                │  ← small-caps mono label
│   ฿1,430,700  value                                                         │  ← THE headline, biggest type
│   ▲ ฿146,200 total return (+11.4%)   ·   +9.4% IRR · money-weighted         │  ← one supporting line
│   ▁▂▃▄▅▆▇█  18 months                                          [ Trends ▸ ] │  ← one calm sparkline + disclosure
│  ───────────────────────────────────────────────────────────────────────  │
│   HOLDINGS                                                                  │
│   ● EXAMPLE-FUND-A     ฿612,000   +12.1%   ▕▔▔▔▔▔▔▏ 48%                   → │  ← standings, drill-in
│   ● K-EQUITY           ฿404,000    +6.8%   ▕▔▔▔▏    31%                   → │
│   ● SCBSET             ฿268,000    −2.0%   ▕▔▔▏     21%                   → │
│  ───────────────────────────────────────────────────────────────────────  │
│   RECENTLY                                          [ See all activity → ]  │  ← a 3-item TAIL, not the feed
│   ↑  Bought  EXAMPLE-FUND-A   12 Jun · 1,000 @ ฿50.00            ฿50,000   │
│   ↓  Sold    K-EQUITY          8 Jun · 600 @ ฿50.00             ฿30,000    │
│        ⤷ Realized +฿4,200 banked                                          │  ← the one flash of green
│   ◆  Dividend SCBSET           3 Jun · paid to cash             +฿1,150    │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Headline content:** lead with **value now** (the emotional answer to "how's my money?"),
then total return + IRR. IRR caption "money-weighted"; under ~28 days → its `irrUnavailable`
reason, never a bare dash. `[ Trends ▸ ]` expands **in place** (no nav) to the two house
`Sparkline`s + a stat line:

```
│   ▾ Trends                                                                  │
│     ┌ value vs cost basis ─────────┐  ┌ net invested / month ───────────┐  │
│     │ value ──────────╱╲────╱       │  │ ▃▅▂▆▃▇                          │  │
│     │ basis ····__---‾‾‾‾‾‾         │  │                                 │  │
│     └──────────────────────────────┘  └─────────────────────────────────┘  │
│     realized ฿146,200 banked · invested ฿1,284,500 · income ฿38,400        │
```

## 4. `/portfolio/activity` — the full feed (zoom out; reached, not resident)

A focused, filterable surface for the cross-fund job ("what did I do across everything",
bulk reconcile, find one entry). Opened by "See all activity →". A thin recap bar, then the
full month-grouped `EventCard` feed with filters where audit actually happens.

```
┌─ ‹ Portfolio · All activity ───────────────────────────────────  [ + Add ] ─┐
│   ฿146,200 realized  ·  +9.4% IRR · money-weighted  ·  over 18 months        │  ← thin recap, not a 2nd hero
│   ───────────────────────────────────────  [ All funds ▾ ]  [ All types ▾ ] │  ← filters live here
│   JUNE 2026                                                                  │
│   ┌──────────────────────────────────────────────────────────────────────┐ │
│   │  ↑  Bought  EXAMPLE-FUND-A                              ฿50,000        │ │
│   │     12 Jun · 1,000 units @ ฿50.00 · Broker X                         │ │
│   └──────────────────────────────────────────────────────────────────────┘ │
│   ┌──────────────────────────────────────────────────────────────────────┐ │
│   │  ↓  Sold  K-EQUITY        8 Jun · 600 @ ฿50.00          ฿30,000       │ │
│   │     ⤷ Realized +฿4,200 banked                                        │ │
│   └──────────────────────────────────────────────────────────────────────┘ │
│   ◆  Dividend  SCBSET   3 Jun · paid to cash                 +฿1,150        │
│   MAY 2026                                                                   │
│   ⚑  Starting balance  EXAMPLE-FUND-A  1 May · 10,000 u · avg ฿50  ฿500,000 │  ← anchor floor, muted
│   … 38 more                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

Same `EventCard` + `ActivityFeed` components as everywhere; scope = all owned buckets.
Filters narrow by fund/type/year and re-scope the recap bar. Tapping any card edits in
place (§8).

## 5. `/portfolio/[ticker]` — position page (zoom in; 04 placement, 01 hierarchy)

Projection on top, the ledger it derives from below. The seam is the teaching moment.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ‹ Portfolio                                                  [ + Record ]    │
│  EXAMPLE-FUND-A                                          Global Equity Fund   │
│  ───────────────────────────────────────────────────────────────────────────│
│   ฿182,400 value now                                                          │
│   ▲ ฿22,900 (+14.4%) unrealised   ·   IRR +14.8% money-weighted               │
│   1,240.55 units · avg cost ฿129.42                                           │
│   ┌──── cost basis vs value over time ──────────────────────────────────┐    │
│   │  value ───────────────────────────╱╲───────╱  ╲────╱                 │    │
│   │  basis ········· ___---‾‾‾‾___------‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾            │    │
│   └─────────────────────────────────────────────────────────────────────┘    │
│  HOW YOU GOT HERE                                       realized  +฿4,200     │
│  ───────────────────────────────────────────────────────────────────────────│
│   2025                                                                        │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │  ↓  Sold        18 Feb   180 @ ฿142.00                    ฿25,560      │  │
│   │     ⤷ Realized +฿4,200 banked · cost ฿21,360                         │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│   ↑  Bought        9 Apr   100 @ ฿136.20                      ฿13,620        │
│   2024                                                                        │
│   ◆  Dividend     20 Nov   — paid to cash                     +฿1,180        │
│   ↑  Bought        2 Aug   300 @ ฿131.50                      ฿39,450        │
│   ⚑  Starting balance   5 Jan   600 units · avg cost ฿118.00  ฿70,800        │  ← anchor, muted
│  Average cost. Returns money-weighted, in THB. For information only.          │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 6. Event card anatomy (one component, every surface)

Used in the Recently peek, `/portfolio/activity`, the position list, and import-confirm
drafts. In the position list the fund is implicit → type leads; elsewhere the fund shows.

- Glyph + verb-first label: `↑ Bought` (`--accent`), `↓ Sold` (`--loss`),
  `◆ Dividend/Fee/Reinvest/Split` (`--muted`/teal), `⚑ Starting balance / Restatement`
  (`--amber`/teal anchor — never styled as a trade).
- Right-aligned amount in `--font-mono`; income/positive shows `+`.
- Sub-line: date · units @ price · source (mono, `--muted`).
- Sell tail: `⤷ Realized +฿4,200 banked` — the only green accent in the stream (from
  `analytics.realized`, keyed `ticker|tradeDate`).
- Tap → expands in place into the inline editor (§8). No per-row pencil clutter.

## 7. Recording — one smart "Add" (auto-detect + confirm)

`+ Add`/`+ Record` opens a compose sheet (bottom sheet mobile / right drawer desktop); the
view behind stays visible. **No mode toggle.** The user brings data; we classify it and
confirm in plain words.

1. **Bring it.** One drop zone + paste box + photo + "type a row" — all feed the same
   parser/OCR (`parseTxnPaste`, `/api/import/transactions-image`). The newcomer's obvious
   move — photograph the current broker screen — Just Works.
2. **Detect the kind** (UI-layer classifier over parsed fields, `classifyImport()`): rows
   with **units + value/avg-cost, no dates/verbs → "current holdings" (snapshot → starting
   balances)**; rows with **dates + buy/sell/dividend types → "buy/sell history"
   (activity)**.
3. **Confirm the kind — the one load-bearing choice, pre-selected:**

```
┌──────────── Add to portfolio ─────────────────────────────┐
│  We read 5 rows. They look like:                          │
│     ( • ) Your current holdings   → set as starting balances│
│     (   ) A buy/sell history      → add as activity         │  ← one glance to verify
│            you can switch                                   │
│  ─────────────────────────────────────────────────────────│
│   ● EXAMPLE-FUND-A   1,240.55 u   avg ฿118.00   ฿182,400   │  ← editable draft rows,
│   ● K-EQUITY         3,000.00 u   avg ฿—        ฿404,000   │     framed as the chosen kind
│   ● SCBSET             ░░░ u      avg ฿92.10    ฿268,000   │  ← amber: needs units
│   Cost unknown? Leave avg blank — gains stay hidden until  │
│   you add it.                                              │
│   Portfolio [ Core ▾ ]            4 ready · 1 needs a unit │
│                  [ Set as my portfolio ✓ ]                 │
└────────────────────────────────────────────────────────────┘
```

   Switching the radio re-frames the same rows (date/type columns for activity;
   units/avg-cost for snapshot) and re-routes the save — snapshot → `opening` anchors,
   activity → trade deltas, both `POST /api/transactions`. Nothing saves on a guess.

4. **One-event quick path** (default body when there's nothing to parse): chip type picker,
   one fund (pre-bound on a position page), amount, date, derived units/price.

```
   What happened?  [ ↑ Bought ][ ↓ Sold ][ ◆ Dividend ][ Fee ][ … ]
   Fund [ EXAMPLE-FUND-A ⌄ ]   Amount ฿[ 50,000 ]   Date [ 12 Jun 2026 ]
   Units 1,000 · Price ฿50.00 (derived, editable) ⟳    Source [ Broker X ⌄ ]
                         [ Add to story ✓ ]
```

**Onboarding default:** a brand-new empty portfolio opens on the snapshot framing ("Add
what you hold"). Once holdings exist, `+ Record` defaults to the one-event activity path.

## 8. Editing & deleting

- **Edit:** tap a card → flips in place into an inline editor (date / type / units / price /
  fee / amount / source / note), `Save`/`Cancel`. Save (`PATCH /api/transactions/[id]`)
  rebuilds the projection; the summary above visibly updates — cause and effect on one
  screen.
- **Delete trade:** immediate, with an **Undo** snackbar (~8s).
- **Delete an anchor** (Starting balance / Restatement): in-app `ConfirmDialog` (never native
  `confirm()`) — it re-bases everything downstream:

```
┌─ Delete the starting balance for EXAMPLE-FUND-A? ─────────┐
│  This anchor sits under 4 later events. Deleting it       │
│  recomputes units, average cost, and every gain here.     │
│                      [ Keep it ]   [ Delete and recompute ]│
└────────────────────────────────────────────────────────────┘
```

## 9. Performance & realized gains — where they surface

- **Value / return / IRR** — the `/portfolio` headline + the position header. Caption
  "money-weighted"; null → `irrUnavailable` reason.
- **Realized gain** — on the sell card's green tail (where banked) + in the Trends stat line
  and the `/portfolio/activity` recap bar.
- **Cost basis over time** — the one chart on the position page (value vs basis); plus the
  `/portfolio` Trends disclosure (value-vs-basis + net-invested sparklines).
- Scope-aware: position page = that fund; glance + activity route = whole portfolio. All
  from `/api/transactions/analytics?bucket=…` (fixed).

## 10. Empty & first-run

Snapshot-first invitation (the right first mental model), no empty grid:

```
┌──────────────────────────────────────────────────────────────┐
│              ✦  Add what you hold                             │
│   Snap a photo of your broker screen, paste it, or type it —  │
│   we'll set it up as your starting point. Then every buy,     │
│   sell, and dividend builds your story from there.            │
│      [ + Add my portfolio ]   [ Paste ]   [ Photo ]           │
└──────────────────────────────────────────────────────────────┘
```

## 11. Responsive / mobile

The glance, activity route, and position ledger are all single-column vertical scrolls.
Portfolio glance → tap a holding → position page, or "See all activity →" → activity route;
tap any event to expand. `+ Add`/`+ Record` is a bottom sheet; the kind-confirm radio sits
at its top; compose is one screen of large native inputs (no wizard steps).

```
┌─────────────────────────┐   ┌─────────────────────────┐
│ Portfolio        [+ Add]│   │ ‹ All activity   [funds▾]│
│ ฿1,430,700 value        │   │ ฿146,200 realized       │
│ ▲+11.4% · +9.4% IRR     │   │ JUNE 2026               │
│ ─ Holdings ──────────── │   │ ↑ Bought EX-FUND ฿50,000│
│ ● EXAMPLE-FUND-A   48% →│   │ ↓ Sold K-EQ ⤷+฿4,200    │
│ ● K-EQUITY         31% →│   │ ◆ Div SCBSET   +฿1,150  │
│ ─ Recently ──[see all →]│   │ … 38 more               │
│ ↑ Bought EX-FUND ฿50,000│   └─────────────────────────┘
│ ↓ Sold K-EQ ⤷+฿4,200    │
└─────────────────────────┘
```

## 12. Build plan (backend fixed — UI layer only)

**New components / routes**
- `EventCard` — shared card (peek + activity route + position list + import draft) with
  inline-edit expand.
- `ActivityFeed` — month-grouped `EventCard` list + optional recap bar + filters; takes a
  `scope` (bucket | all). Powers `/portfolio/activity` and the position "how you got here".
- `PortfolioGlance` — the default `/portfolio`: headline + Trends disclosure + holdings
  standings + 3-item Recently peek.
- `ActivityRoute` (`/portfolio/activity`) — recap bar + filters + `ActivityFeed` scope=all.
- `PositionPage` (`/portfolio/[ticker]`) — summary header + basis chart + `ActivityFeed`
  scoped to the ticker.
- `RecordSheet` — compose drawer/bottom-sheet: one-event chip form + paste/photo →
  `classifyImport()` → kind-confirm radio → editable draft rows. Replaces
  `AddTransactionsSheet` + `AddToPortfolioSheet`; absorbs `AddHoldingsSheet`'s snapshot path.
- `classifyImport()` — pure UI helper: parsed rows → `"snapshot" | "activity"` + confidence.

**Changed**
- `PortfolioScreen` — becomes `PortfolioGlance` (headline-first); Holdings rows link to
  position pages; header buttons → single `+ Add`; add "See all activity →".
- `App.tsx` / routing — add `/portfolio/activity` + `/portfolio/[ticker]`; drop the
  `ActivityModal` / `AddToPortfolioSheet` wiring.

**Retired** — `ActivityModal.tsx`, `AddToPortfolioSheet.tsx`, `AddTransactionsSheet.tsx`
(logic salvaged into `RecordSheet`); `AddHoldingsSheet` snapshot path folds into
`RecordSheet`'s snapshot branch.

**Reused untouched** — every `/api/transactions*` + `/api/import/transactions-image` route;
`parseTxnPaste`, `normalizeTxnDraft`, `coerceKind`, `inferQuoteSource`, ticker/source
autocomplete, `Sparkline`, `ConfirmDialog`, `Modal`/sheet primitives, design tokens.

## 13. Futureproofing (#35 backtest / #36 planner)

Not built now; **no reserved slots in any activity surface** (keeps them clean). When built:
- `ActivityFeed`/headline already read a generic `scope`, so a backtest "as-if" series can
  reuse the same components.
- Likely homes: **#35 backtest → Explore** (fund discovery/comparison); **#36 wealth/
  retirement planner → the Plan area** (today a free-text plan in `Journal → Plan`; a
  quantitative projection pairs naturally beside the written strategy, or earns its own
  surface). Both **deep-link from Portfolio with scope** ("Backtest this mix" on the
  headline, "Backtest this fund" on a position page). Final home decided when they're real.
