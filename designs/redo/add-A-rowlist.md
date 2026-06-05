# Add to portfolio — Shared-element minimalist (one row, everywhere)

**Lens:** Maximize element sharing between mobile and desktop. The review surface is a single LIST of native holdings-style rows (`.holding` grammar: swatch + name/sub + value) — identical on both platforms. Only the container chrome differs (centered `.modal` vs full-bleed bottom-sheet `.modal`). Each row carries its Type via swatch + label; tapping a row expands the native `.ledger-edit` editor in place. One row component, used in the modal *and* already living on the Portfolio screen. Instantly familiar.

---

## 1. The core mechanism

There is no holdings-vs-history mode. The modal is a **single list of `.holding` rows**, and every row owns a **Type** — either `Starting balance` (a snapshot anchor) or a trade kind (`Buy / Sell / Dividend / Fee / Split / Reinvest`). Auto-detect stamps each row's Type from the intake (a dated buy/sell token → that trade; a bare symbol + quantity → Starting balance), so the snapshot-vs-transaction call is made *for* the user, per row, never as an upfront question. The row's **swatch encodes Type at a glance** (mark glyph `▸ + − ◦ · ⋈ ↺` over a tinted background) and its `.value` shows the resolved amount. Tapping a row expands the native `.ledger-edit` editor *in place*, where a Type dropdown spans Starting balance + all trade kinds — change the Type and the editor's fields reshape. One **Save** posts every row to `POST /api/transactions`, each routed by its own Type. Because it is the exact `.holding` row used on the Portfolio screen, the review list reads as "your portfolio, pre-commit."

---

## 2. Desktop — annotated ASCII mockup (review state)

Centered `.modal` (`.modal--form`, max-width 560px — the owner's preferred narrow size). Header → intake strip → shared row list → footer.

```
        ┌──────────────────────────────────────────────────────────┐  ← .modal-overlay (rgba .32)
        │  Add to portfolio                                    [✕]  │  .modal-header
        │  3 rows ready · detected from paste          .modal-close │  .modal-title / .modal-subtitle
        ├──────────────────────────────────────────────────────────┤
        │  ┌────────────────────────────────────────────────────┐  │  .modal-body
        │  │ [ Paste · CSV ] [ Image ] [ + Add row ]            │  │  .method-tabs  (intake, shared)
        │  └────────────────────────────────────────────────────┘  │
        │                                                          │
        │   ┌── REVIEW (the shared .holding list) ─────────────┐   │
        │   │ ▢▸  EXAMPLE-FUND-A          1,000 units    ฿25,000│   │  ← .holding  (Starting balance)
        │   │ amber  Starting balance · avg ฿25.00              │   │  .swatch ▸ / .name / .sub / .value
        │   ├──────────────────────────────────────────────────┤   │
        │   │ ▢+  K-EQUITY               12 Mar · Buy    ฿15,300│   │  ← .holding  (Buy)
        │   │ green  100 units · ฿153.00/u · fee ฿20            │   │  .swatch + / .sub mono detail
        │   ├──────────────────────────────────────────────────┤   │
        │   │ ▢−  K-EQUITY               28 Mar · Sell    ฿8,100│   │  ← .holding  (Sell)
        │   │ red    50 units · ฿162.00/u · +฿450 gain          │   │  .swatch − / .delta.up clause
        │   └──────────────────────────────────────────────────┘   │
        │   <div className="modal-body-sentinel" />                 │
        ├──────────────────────────────────────────────────────────┤
        │                       [ Cancel ]   [ Save 3 to portfolio ]│  .modal-footer (.btn ghost/.primary)
        └──────────────────────────────────────────────────────────┘
```

Rows are the **literal `.holding` grid** (`32px 1fr auto`): swatch · name+sub · value. The only addition vs. the Portfolio screen is the swatch's **mark glyph** (reusing the `.evline__mark` vocabulary: `▸ + − ◦ · ⋈ ↺`) and a Type word in `.sub`. A Starting-balance row's swatch is amber-tinted (`var(--amber)` over `--card-soft`); a Sell is loss-tinted; a Buy accent-tinted. No grid, no segment control, no second table.

---

## 3. Mobile — annotated ASCII mockup (SAME surface, bottom sheet)

Same `.modal` panel, re-chromed as a **full-bleed bottom sheet** (`width:100%`, bottom-pinned, top corners `--r-2xl`, grab handle). The body — intake strip + the identical `.holding` list — is **byte-for-byte the same component**; only the panel position/animation differs.

```
   ┌────────────────────────────────────────────┐  ← full-bleed; slides up from bottom
   │                  ────                       │  grab handle
   │  Add to portfolio                      [✕]  │  .modal-header (same)
   │  3 rows ready · detected from paste         │  .modal-subtitle (same)
   ├────────────────────────────────────────────┤
   │  [ Paste·CSV ] [ Image ] [ + Add row ]      │  .method-tabs (same, scrolls x if tight)
   │                                             │
   │  ▢▸  EXAMPLE-FUND-A                  ฿25,000 │  ← SAME .holding row
   │  amber  Starting balance · 1,000u · ฿25.00  │     (sub wraps detail under name)
   │ ─────────────────────────────────────────── │
   │  ▢+  K-EQUITY            12 Mar     ฿15,300  │  ← SAME .holding row (Buy)
   │  green  100u · ฿153.00/u · fee ฿20           │
   │ ─────────────────────────────────────────── │
   │  ▢−  K-EQUITY            28 Mar      ฿8,100  │  ← SAME .holding row (Sell)
   │  red    50u · ฿162.00/u · +฿450 gain         │
   │                                             │
   ├────────────────────────────────────────────┤  footer pinned (safe-area inset)
   │        [ Save 3 to portfolio ]   (.full)    │  .btn.primary.full ; Cancel = handle/✕
   └────────────────────────────────────────────┘
```

**What's shared:** the entire body — intake `.method-tabs`, the `.holding` rows, the `.ledger-edit` expansion, header text. **What differs (chrome only):** centered panel ↔ bottom sheet; footer is a right-aligned `.btn` pair on desktop vs. a single `.btn.full` primary on mobile (Cancel collapses into the handle/✕); the `.sub` detail line *wraps* under the name on mobile rather than sitting inline. Same rows, layout adapts.

---

## 4. The intake — paste / image / type, no confusing segment

A single `.method-tabs` strip — **Paste · CSV** | **Image** | **+ Add row** — sits above the list. These are *how data arrives*, not *what kind it is*, so there is no holdings/history toggle anywhere.

- **Paste · CSV** → a `.sheet-input` textarea (mono). On paste, lines are parsed and **each becomes a `.holding` row with an auto-detected Type**; the textarea collapses, the list fills.
- **Image** → the native `.drop-zone` (drag/click). OCR returns the same rows.
- **+ Add row** → appends one blank `.holding` already expanded into `.ledger-edit`, defaulting to `Starting balance`.

Every path lands in the **same row list** — the detected Type is shown on the swatch + `.sub` so the user can scan and trust (or fix) the classification before saving.

## 5. Editing a row & changing its Type (native `.ledger-edit`)

Tapping any `.holding` row expands the native **`.ledger-edit`** inline, pushing rows below down (the row stays in place — no nav, no second screen, identical on both platforms). The first control is the **Type dropdown** spanning `Starting balance · Buy · Sell · Dividend · Fee · Split · Reinvest`. The field set reshapes by Type:

```
 ▢+  K-EQUITY                 12 Mar · Buy        ฿15,300   ← tapped row (collapses on save)
 ┌── .ledger-edit (expanded in place) ───────────────────┐
 │  Type  [ Buy            ▾ ]   ← spans anchor + trades  │
 │  Date  [ 2026-03-12 ]   Symbol [ K-EQUITY        ]     │  .sheet-input grid
 │  Units [ 100 ]  Price [ 153.00 ]  Fee [ 20 ]          │  (Amount auto = units×price+fee)
 │                          [ Done ]                      │
 └───────────────────────────────────────────────────────┘
```

Switch Type → `Starting balance` and the same editor collapses to **Symbol · Units · Avg cost** (Avg cost optional). The swatch glyph + tint and the collapsed `.value`/`.sub` update live. One editor, every Type, reused verbatim mobile↔desktop.

## 6. Empty / first-run, and cost-unknown

**Empty / first-run** — the body shows the intake strip plus a native empty-state card (`.card`, centered, emoji + heading + muted copy), no fake rows:

```
   📥   Add your holdings or trades
        Paste a statement, drop a screenshot,
        or add a row by hand. We'll sort out
        what's a balance and what's a trade.
        [ + Add row ]   (.btn.accent)
```

**Cost-unknown Starting balance** — Avg cost stays blank; the row saves fine (the anchor needs only Symbol + Units). The row surfaces it the native way — an `.evline-anchor__note` style amber line under the `.sub`:

```
 ▢▸  EXAMPLE-FUND-B               2,500 units    ฿—
 amber  Starting balance · cost basis not recorded   ← var(--amber)
```

The `.value` shows `฿—` (or the live-NAV-derived value once priced); nothing blocks Save.

## 7. Shared-component table

| Component (native class) | Role in modal | Shared mobile ↔ desktop? |
| --- | --- | --- |
| `.modal` + `.modal-header/-body/-footer` | Shell | **Shell shared; chrome differs** — centered panel vs full-bleed bottom sheet (position/animation/footer layout only) |
| `.holding` (`.swatch`/`.name`/`.sub`/`.value`) | **The review row — one component, everywhere** | **Yes — identical** (also used on Portfolio screen) |
| `.swatch` + `.evline__mark` glyph vocabulary | Encodes Type per row (`▸ + − ◦ · ⋈ ↺` + tint) | **Yes — identical** |
| `.ledger-edit` | In-place row editor + Type dropdown | **Yes — identical** |
| `.method-tabs` | Intake selector (Paste·CSV / Image / + Add row) | **Yes — identical** |
| `.sheet-input` (textarea + fields) | Paste box & editor inputs | **Yes — identical** |
| `.drop-zone` | Image / OCR intake | **Yes — identical** |
| `.delta.up/.down` | Gain clause on Sell rows | **Yes — identical** |
| Empty state (`.card` + emoji/heading) | First-run | **Yes — identical** |
| `.btn.ghost` + `.btn.primary` / `.btn.full` | Footer actions | **Shell shared; layout differs** (pair right-aligned vs single `.full`) |

Net: every *content* element is shared; only modal positioning + footer arrangement is platform-specific.

## 8. Cognitive-load tactics

1. **Detection classifies; the user only corrects.** Auto-detect stamps each row's Type from the intake, so "snapshot or transaction?" is answered per row before the user looks — the swatch glyph + tint make a wrong guess obvious to fix, not a decision to make.
2. **One surface, one familiar row.** No modes, no segment controls, no second table. The review row is the *same `.holding`* the user already reads on the Portfolio screen — recognition, not learning.
3. **Progressive disclosure via in-place expand.** Rows show only swatch + name + Type + value until tapped; full fields live inside `.ledger-edit` and appear only when editing — never more than needed at a step.
4. **Optional stays optional.** Cost-unknown anchors save with a quiet amber note (`var(--amber)`), never a blocking error — the modal never demands data it doesn't strictly need, and Save is always one tap.
