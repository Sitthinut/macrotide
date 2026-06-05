# Macrotide Design System Catalog

**Purpose:** Precise reference for reusing the app's existing design patterns—classes, typography, spacing, colors—when building new transaction history, performance summaries, record/import modals, and position detail views. This is NOT prose; it's a lookup table with real class names, CSS values, and JSX snippets copied from production code.

---

## 1. Screen Shell

### `.screen`
- **What:** Container for a full-screen view (Portfolio, Markets, Journal, Chat, etc.).
- **CSS:** Base class with `opacity: 1`; flex column layout managed by parent container.
- **Layout:** Usually paired with `.topbar` (sticky, ~50px height) + tab bar (`.sub-tabs` or `.portfolio-switch`) stacked below, then scrollable content.

### `.topbar`
- **What:** Sticky header bar docked to the top of each screen.
- **CSS:** 
  - `position: sticky; top: var(--demo-banner-h, 0px); z-index: 30`
  - `display: flex; align-items: center; justify-content: space-between; gap: 12px`
  - `padding: 14px 16px 8px; min-height: var(--topbar-h); height: var(--topbar-h)` (mobile: 50px)
  - `background: var(--bg)` (solid, no transparency)
  - Hides on scroll via `useScrollHide` (toggles `[data-topbar-hidden="true"]` on body)

### `.brand`
- **What:** Left-side screen title + optional badge.
- **CSS:**
  - `font-size: 16px; font-weight: 500; letter-spacing: -0.02em`
  - `display: flex; align-items: center; gap: 9px`
- **Pattern:**
  ```jsx
  <div className="brand" style={{ flex: 1 }}>
    <span>Portfolio</span>
    {isDemo && <span className="brand-chip">DEMO</span>}
  </div>
  ```

### `.brand-chip`
- **What:** Small badge next to brand (e.g., "DEMO", version).
- **CSS:**
  - `font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.04em`
  - `padding: 2px 6px; border-radius: 4px`
  - `background: var(--card-soft); border: 1px solid var(--line-soft); color: var(--muted)`

### Screen with sub-tabs: `.sub-tabs`
- **What:** Horizontal segmented tab bar (e.g., "Today | Learn" on Markets).
- **CSS:**
  - `display: flex; gap: 4px; padding: 8px 16px; margin-bottom: 8px; margin-top: -2px`
  - `position: sticky; top: calc(var(--topbar-h) - 2px + var(--demo-banner-h, 0px)); z-index: 20`
  - `background: var(--bg); overflow-x: auto; scrollbar-width: none`
- **Button styling:**
  - Base: `background: transparent; border: 0; color: var(--muted); font-size: 13px; font-weight: 500; padding: 6px 12px; border-radius: var(--r-full)`
  - Active (`[data-active="true"]`): `background: var(--ink); color: var(--bg)`
- **Pattern:**
  ```jsx
  <div className="sub-tabs">
    <button data-active={tab === "today"} onClick={() => setTab("today")}>
      Today
    </button>
    <button data-active={tab === "learn"} onClick={() => setTab("learn")}>
      Learn
    </button>
  </div>
  ```

---

## 2. Section Headers

### `.section-header` (with `.section`)
- **What:** Title + optional right-side action (link, button).
- **CSS:**
  - Container: `padding: 0 16px; margin-bottom: 14px`
  - Header itself: `display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 6px; padding: 0 4px`
- **Typography:** 
  - `<h3>` inside: `font-size: 14px; font-weight: 500; letter-spacing: -0.01em; color: var(--ink); margin: 0`
  - Right side (`.link`): `font-size: 11px; color: var(--muted); text-decoration: none; white-space: nowrap; font-weight: 400`
- **Pattern:**
  ```jsx
  <div className="section">
    <div className="section-header">
      <h3>Holdings</h3>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="link">View all</span>
        <button className="icon-btn" onClick={onAction}>
          <Icon name="settings" size={14} />
        </button>
      </span>
    </div>
    {/* content below */}
  </div>
  ```

---

## 3. Row / List Item Patterns

### Holdings Row (`.holdings-list` / `.holding`)
- **What:** Dense list of invested positions—the canonical row pattern.
- **Container:** `.holdings-list` — `padding: 0 8px`
- **Row:** `.holding`
  - **Grid:** `display: grid; grid-template-columns: 32px 1fr auto; align-items: center; gap: 10px; padding: 8px; border-radius: 8px; cursor: pointer`
  - Hover: `background: var(--card-soft)`
- **Swatch (color + abbr):** `.swatch`
  - `width: 32px; height: 32px; border-radius: 8px; display: grid; place-items: center`
  - `font-family: var(--font-mono); font-size: 9.5px; font-weight: 600; color: white` (dark text in light themes via media query)
  - Example: green bg with "S&P" label for S&P 500 fund
- **Left column (text):**
  - `.name`: `font-size: 13px; font-weight: 500; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
  - `.sub`: `font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis`
- **Right column (numbers):**
  - `.value`: `font-family: var(--font-mono); font-size: 12.5px; text-align: right; font-variant-numeric: tabular-nums`
  - `.pct`: `font-family: var(--font-mono); font-size: 10.5px; text-align: right; font-variant-numeric: tabular-nums`
- **Pattern:**
  ```jsx
  <div className="holdings-list">
    {holdings.map(h => (
      <button className="holding" key={h.ticker} onClick={() => openDetail(h)}>
        <div className="swatch" style={{ background: h.color }}>S&P</div>
        <div>
          <div className="name">{h.name}</div>
          <div className="sub">{h.ticker}</div>
        </div>
        <div>
          <div className="value">฿{h.value.toLocaleString()}</div>
          <div className="pct">{(h.pctOfTotal * 100).toFixed(1)}%</div>
        </div>
      </button>
    ))}
  </div>
  ```

### Transaction / Event Row (`.evline`)
- **What:** Single-line transaction entry (buy, sell, dividend, fee) in transaction history.
- **Structure:** Mark (gutter) | Date · Verb · Ticker | Detail line (units, price, gains) | Amount (right-aligned, mono, bold).
- **CSS:**
  - `display: flex; gap: 12px; align-items: baseline; width: 100%`
  - `background: transparent; border: none; border-bottom: 1px solid var(--line-soft); padding: 10px 4px; cursor: pointer`
  - Hover: `background: color-mix(in oklab, var(--ink) 2.5%, transparent)`
- **Gutter mark (`.evline__mark`):**
  - `flex: none; width: 14px; text-align: center; font-family: var(--font-mono); font-size: 13px; color: var(--muted)`
  - Values: `"+"` (buy), `"−"` (sell), `"◦"` (div), `"·"` (fee), `"⋈"` (split), `"↺"` (reinvest), `"▸"` (anchor: start), `"↻"` (anchor: restate)
- **Main (`.evline__main`):**
  - `flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px`
  - **Top (`.evline__top`):** `display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap`
    - Date: `font-family: var(--font-mono); font-size: 11.5px; color: var(--muted); white-space: nowrap`
    - Verb: `font-size: 13.5px; font-weight: 500` (e.g., "Bought", "Sold")
    - Ticker: `font-family: var(--font-mono); font-size: 12px; color: var(--ink-soft)`
  - **Detail (`.evline__detail`):** `font-family: var(--font-mono); font-size: 11px; color: var(--muted)`
    - Content: Units · price/unit, then optional gain clause (colored `var(--gain)` or `var(--loss)`)
- **Right (`.evline__amount`):**
  - `flex: none; margin-left: auto; font-family: var(--font-mono); font-size: 13.5px; font-weight: 500; white-space: nowrap`
- **Pattern:**
  ```jsx
  <button type="button" className="evline" onClick={onEdit}>
    <span className="evline__mark">+</span>
    <span className="evline__main">
      <span className="evline__top">
        <span className="evline__date">12 Mar 2026</span>
        <span className="evline__verb">Bought</span>
        <span className="evline__ticker">K-USA-A</span>
      </span>
      <span className="evline__detail">
        100 units · ฿25.50/unit
        {realized !== null && (
          <span style={{ color: realized >= 0 ? "var(--gain)" : "var(--loss)" }}>
            {" · "}+฿1,250 gain
          </span>
        )}
      </span>
    </span>
    <span className="evline__amount">฿2,550</span>
  </button>
  ```

### Anchor Row (`.evline--anchor`)
- **What:** Set-apart premise rows (Starting Balance, Restatement) displayed at the bottom of a transaction list.
- **CSS:**
  - `display: block; width: 100%; border: none; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line-soft); padding: 11px 4px`
  - Hover: `background: color-mix(in oklab, var(--ink) 2.5%, transparent)`
- **Children:**
  - `.evline-anchor__label`: `font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px`
  - `.evline-anchor__body`: `display: flex; align-items: baseline; gap: 12px`
    - Date: `font-family: var(--font-mono); font-size: 11.5px; color: var(--muted)`
    - Ticker: `font-family: var(--font-mono); font-size: 12px; color: var(--ink-soft)`
    - Units: `font-family: var(--font-mono); font-size: 11.5px; color: var(--muted)`
    - Amount: `margin-left: auto; font-family: var(--font-mono); font-size: 13px; font-weight: 500`
  - `.evline-anchor__note`: `font-size: 11px; color: var(--amber); margin-top: 4px` (for "cost basis not recorded")

### Market Index Row (card grid)
- **What:** 2-column grid of live market indices (Indices section).
- **Container:** `.card` with `padding: 0`
- **Grid cell:**
  - `display: grid; grid-template-columns: 1fr 1fr`
  - Cell: `padding: 12px; border-right: 1px solid var(--line-soft)` (except last column), `border-bottom: 1px solid var(--line-soft)` (except last row)
- **Label (`.sym`):** `font-size: 10px; color: var(--muted); font-family: var(--font-mono); letter-spacing: 0.04em`
- **Value:** `font-size: 16px; margin-top: 3px; font-weight: 500; font-variant-numeric: tabular-nums`
- **Delta (`.delta`):** `font-size: 11px; margin-top: 1px; color: var(--gain) or var(--loss)`
- **Pattern:**
  ```jsx
  <div className="card" style={{ padding: 0 }}>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
      {indices.map((idx, i) => (
        <div key={idx.sym} style={{
          padding: 12,
          borderRight: i % 2 === 0 ? "1px solid var(--line-soft)" : "none",
          borderBottom: i < indices.length - 2 ? "1px solid var(--line-soft)" : "none"
        }}>
          <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
            {idx.sym}
          </div>
          <div className="num" style={{ fontSize: 16, marginTop: 3, fontWeight: 500 }}>
            {idx.val.toFixed(2)}
          </div>
          <div className={`delta ${idx.d >= 0 ? "up" : "down"}`} style={{ fontSize: 11, marginTop: 1 }}>
            {idx.d >= 0 ? "▲" : "▼"} {Math.abs(idx.d).toFixed(2)}%
          </div>
        </div>
      ))}
    </div>
  </div>
  ```

---

## 4. Cards & Summary Blocks

### `.card`
- **What:** Paper card with subtle border and padding.
- **CSS:**
  - `background: var(--paper); border-radius: var(--r-lg); padding: var(--pad-card); border: 1px solid var(--line-soft)`
  - `--r-lg: 14px; --pad-card: 16px` (or 12px in compact mode)

### `.card-soft`
- **What:** Soft-background card (muted, lower contrast).
- **CSS:**
  - `background: var(--card-soft); border-radius: var(--r-lg); padding: var(--pad-card)`
  - No border

### `.hero-block`
- **What:** Large headline number showing portfolio total or position value.
- **Container:** `padding: 6px 16px 4px`
- **Label (`.hero-label`):**
  - `font-size: 10.5px; color: var(--muted); letter-spacing: 0.02em; margin-bottom: 4px; font-weight: 400`
- **Value (`.hero-value`):**
  - `font-size: 36px; font-weight: 500; letter-spacing: -0.035em; line-height: 1; font-variant-numeric: tabular-nums`
  - Cents: `.cents` inside — `color: var(--muted); font-weight: 400; font-size: 22px`
- **Sub (`.hero-sub`):**
  - `display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12.5px; flex-wrap: wrap`
  - Child text: `white-space: nowrap` so items don't split mid-word
- **Pattern:**
  ```jsx
  <div className="hero-block">
    <div className="hero-label">TOTAL VALUE</div>
    <div className="hero-value">
      ฿1,250,000<span className="cents">50</span>
    </div>
    <div className="hero-sub">
      <span>↑</span>
      <span className="delta up">+฿12,500</span>
      <span className="delta-pill">+2.4%</span>
    </div>
  </div>
  ```

### `.delta-pill`
- **What:** Colored badge for change (gain/loss).
- **CSS:**
  - Base: `background: var(--accent-soft); color: var(--accent-ink); font-weight: 500; padding: 3px 8px; border-radius: var(--r-sm); display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums`
  - Down variant (`.down`): `background: color-mix(in oklab, var(--loss) 12%, transparent); color: var(--loss)`

### Recap Strip (`.activity-recap`)
- **What:** Compact grid of KPI cells (Total return, IRR, Fees, etc.).
- **Grid:** `display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin-bottom: 18px`
- **Cell (`.activity-recap__cell`):**
  - `border: 1px solid var(--line-soft); border-radius: 10px; padding: 10px 12px`
- **Label (`.activity-recap__label`):**
  - `font-size: 10px; font-family: var(--font-mono); color: var(--muted); letter-spacing: 0.05em; text-transform: uppercase`
- **Value (`.activity-recap__value`):**
  - `font-size: 19px; font-weight: 600; margin-top: 3px`
- **Caption (`.activity-recap__caption`):**
  - `font-size: 10px; color: var(--muted); margin-top: 2px; line-height: 1.35; -webkit-line-clamp: 2` (clamped to 2 lines)
- **Pattern:**
  ```jsx
  <div className="activity-recap">
    <div className="activity-recap__cell">
      <div className="activity-recap__label">Total Return</div>
      <div className="activity-recap__value">+12.5%</div>
    </div>
    {/* more cells */}
  </div>
  ```

### `.stats-strip`
- **What:** 4-column KPI strip (used for quick metrics).
- **CSS:**
  - `margin: 10px 16px 12px; display: grid; grid-template-columns: 1fr 1fr 1fr 1fr`
  - `background: var(--card-soft); border-radius: var(--r-md); padding: 10px 4px`
  - Cells: `text-align: center; padding: 0 4px; border-right: 1px solid var(--line)` (except last)
- **Label (`.lbl`):** `font-size: 9.5px; color: var(--muted); letter-spacing: 0.05em; margin-bottom: 2px; font-family: var(--font-mono)`
- **Value (`.val`):** `font-size: 12px; font-weight: 500; font-family: var(--font-mono); font-variant-numeric: tabular-nums`

---

## 5. Change / Delta Treatment

### `.delta`
- **What:** Inline change indicator (gain or loss text).
- **CSS:**
  - Base: `font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums`
  - `.up`: `color: var(--gain)` (green, #10a86b light / #19c37d dark)
  - `.down`: `color: var(--loss)` (red, #d14545 light / #f46a6a dark)
- **Pattern:**
  ```jsx
  <span className={`delta ${change >= 0 ? "up" : "down"}`}>
    {change >= 0 ? "+" : ""}฿{Math.abs(change).toFixed(2)}
  </span>
  ```

### `.pct`
- **What:** Percentage value (right-aligned, mono).
- **CSS:** `font-family: var(--font-mono); font-size: 10.5px; text-align: right; font-variant-numeric: tabular-nums`

### Color Tokens
- **Gain:** `var(--gain)` = `#10a86b` (light) / `#19c37d` (dark)
- **Loss:** `var(--loss)` = `#d14545` (light) / `#f46a6a` (dark)
- **Amber (Warning):** `var(--amber)` = `#d89a1f` (light) / `#e4b440` (dark)

### `fmtPct` Helper
```ts
// From lib/format.ts — formats a decimal (e.g., 0.125) as "12.5%"
export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n == null) return "−";
  const sign = n >= 0 ? "" : "−";
  const pct = Math.abs(n) * 100;
  return `${sign}${pct.toFixed(decimals)}%`;
}
```

---

## 6. Chips, Filters, Tabs

### Filter Chips (`.filter-chips`)
- **What:** Horizontal scrolling row of toggle filters.
- **Container:** `.filter-chips`
  - `display: flex; gap: 6px; padding: 4px 16px 8px`
  - `overflow-x: auto; scrollbar-width: none` (hide scrollbar)
- **Chip (`.chip`):**
  - `padding: 4px 11px; border-radius: 999px; background: var(--chip-bg); color: var(--ink-soft); font-size: 11.5px; font-weight: 500; white-space: nowrap; border: 1px solid var(--line-soft); cursor: pointer`
  - Active (`[data-active="true"]`): `background: var(--ink); color: var(--bg); border-color: transparent`
- **Pattern:**
  ```jsx
  <div className="filter-chips">
    {filters.map(f => (
      <button
        key={f.id}
        className="chip"
        data-active={activeFilter === f.id}
        onClick={() => setActiveFilter(f.id)}
      >
        {f.label}
      </button>
    ))}
  </div>
  ```

### Segmented Control / Method Tabs (`.method-tabs`)
- **What:** 2–3 option toggle (e.g., Holdings | Activity on Add sheet).
- **Container:** `.method-tabs`
  - `display: flex; gap: 4px; padding: 2px; background: var(--chip-bg); border-radius: 9px; margin-bottom: 14px`
- **Button:**
  - `flex: 1; background: transparent; border: 0; color: var(--muted); font-family: var(--font-sans); font-size: 12.5px; font-weight: 500; padding: 7px; border-radius: 7px; cursor: pointer`
  - Active (`[data-active="true"]`): `background: var(--chip-active-bg); color: var(--ink); box-shadow: var(--chip-shadow)`
- **Pattern:**
  ```jsx
  <div className="method-tabs">
    <button data-active={method === "paste"} onClick={() => setMethod("paste")}>
      Paste
    </button>
    <button data-active={method === "image"} onClick={() => setMethod("image")}>
      Image
    </button>
  </div>
  ```

### Sub-tabs (`.sub-tabs`) — *See Screen Shell above*

### Portfolio Switch Buttons (`.portfolio-switch`)
- **What:** Sticky row of portfolio selector pills (similar to sub-tabs).
- **CSS:** Same sticky positioning as `.sub-tabs`, but styled as pill buttons instead of plain text.
- **Button styling:**
  - Base: `background: var(--card-soft); border: 1px solid var(--line-soft); color: var(--ink-soft); font-size: 12.5px; font-weight: 500; padding: 7px 12px; border-radius: 999px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0`
  - Active: `background: var(--ink); color: var(--bg); border-color: transparent`
- **Subtext (`.pf-sub`):** `font-family: var(--font-mono); font-size: 9.5px; letter-spacing: 0.04em; color: var(--muted); margin-left: 4px; padding-left: 6px; border-left: 1px solid var(--line)`

---

## 7. Buttons

### `.btn` (base)
- **CSS:**
  - `font-family: var(--font-sans); font-size: 14px; font-weight: 500; border: 0; border-radius: var(--r-md); padding: 11px 18px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: transform 0.06s ease, background 0.18s; letter-spacing: -0.01em`
  - Active: `transform: scale(0.98)`

### Button Variants
- `.btn.primary`: `background: var(--ink); color: var(--bg)` — main call-to-action
- `.btn.accent`: `background: var(--accent); color: white` — secondary call-to-action
- `.btn.ghost`: `background: transparent; color: var(--ink); border: 1px solid var(--line)` — less emphasis
- `.btn.danger`: `background: var(--loss); color: white` — destructive
- `.btn.full`: `width: 100%; display: flex` — block-level button
- `.btn.sm`: `padding: 7px 12px; font-size: 12.5px; border-radius: var(--r-sm)` — small variant
- `.btn.link`: `background: transparent; border: 0; color: var(--muted); padding: 4px 6px; font-weight: 400` — borderless, low emphasis

### Icon Button (`.icon-btn`)
- **What:** Square button for single icon, used in headers / toolbars.
- **CSS:**
  - `width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--line); background: var(--paper); color: var(--ink-soft); display: grid; place-items: center; cursor: pointer; padding: 0; flex-shrink: 0`
  - Hover: `background: var(--card-soft); color: var(--ink)`
  - Focus: `outline: 2px solid var(--accent); outline-offset: 2px`
- **Quiet variant (`.icon-btn.quiet`):**
  - `border-color: transparent; background: transparent; color: var(--muted)`
  - Hover: `background: transparent; color: var(--ink)`
- **Footer size (in `.modal-footer`):** `width: 40px; height: 40px`
- **Pattern:**
  ```jsx
  <button className="icon-btn" aria-label="Edit" onClick={onEdit}>
    <Icon name="pencil" size={14} />
  </button>
  ```

### "+ Add" Accent Button Pattern
- **CSS:** `.btn.accent` or `.btn.primary` + icon
- **Pattern:**
  ```jsx
  <button className="btn accent">
    <Icon name="plus" size={13} /> Add Holding
  </button>
  ```

---

## 8. Modal / Sheet + Forms

### Modal Primitive (`.modal-overlay` + `.modal`)
- **What:** Standard dialog (confirm, form, or detail view).
- **Overlay (`.modal-overlay`):**
  - `position: fixed; inset: 0; background: rgba(0, 0, 0, 0.32); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 24px`
  - Confirm variant (`.modal-overlay--confirm`): `z-index: 200` (stacks above other modals)
- **Panel (`.modal`):**
  - `width: 100%; max-width: 560px; max-height: calc(100vh - 48px); display: flex; flex-direction: column; background: var(--paper); border-radius: 28px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.18); animation: dialogIn 0.25s`
  - Variants:
    - `.modal--confirm`: `max-width: 400px` — confirmation dialogs
    - `.modal--form`: 560px (default) — add/edit sheets
    - `.modal--detail`: `max-width: 640px` — read-only detail view
    - `.modal--txnwide`: `max-width: 880px` (at `min-width: 600px`) — transaction importer

### Modal Header (`.modal-header`)
- **CSS:**
  - `flex: 0 0 auto; display: flex; align-items: flex-start; gap: 12px; padding: 24px 24px 12px`
- **Text area (`.modal-header-text`):** `flex: 1; min-width: 0`
- **Title (`.modal-title`):** `font-size: 18px; font-weight: 500; letter-spacing: -0.02em`
- **Subtitle (`.modal-subtitle`):** `font-size: 12.5px; color: var(--muted); margin-top: 4px`
- **Actions (`.modal-header-actions`):** `flex: 0 0 auto; display: flex; align-items: center; gap: 8px`
- **Close button (`.modal-close`):** `.icon-btn` positioned in top-right
- **Pattern:**
  ```jsx
  <Modal open={open} onClose={onClose} variant="form">
    <Modal.Header>
      <h2 className="modal-title" id="title">Add Holding</h2>
      <p className="modal-subtitle">Choose Holdings or Activity</p>
      <button className="icon-btn quiet modal-close" onClick={onClose}>
        <Icon name="x" size={14} />
      </button>
    </Modal.Header>
  </Modal>
  ```

### Modal Body (`.modal-body`)
- **CSS:**
  - `flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 24px; overscroll-behavior: contain`
  - Detail only (`.modal--detail .modal-body`): `padding-bottom: 24px`
- **Scroll sentinel:** `<div className="modal-body-sentinel" />` (1px invisible div at bottom)
- **Pattern:**
  ```jsx
  <Modal.Body>
    {/* form inputs, cards, etc. */}
    <div className="modal-body-sentinel" />
  </Modal.Body>
  ```

### Modal Footer (`.modal-footer`)
- **CSS:**
  - `flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 16px 24px 24px`
  - Scrolled state (`.modal-footer--scrolled`): `background: var(--footer-scrolled-bg); box-shadow: var(--footer-scroll-shadow)` (soft shadow appears when body is scrolled)
- **Slots:**
  - `.modal-footer-start`: Left-aligned (destructive action)
  - `.modal-footer-end`: Right-aligned (primary action, auto via `margin-left: auto`)
- **Button sizing:** All `.btn` inside footer: `min-height: 40px` (uniform row height)
- **Pattern:**
  ```jsx
  <Modal.Footer>
    <div className="modal-footer-start">
      <button className="btn danger icon-only" onClick={onDelete}>
        <Icon name="trash" size={14} />
      </button>
    </div>
    <div className="modal-footer-end">
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={onSave}>Save</button>
    </div>
  </Modal.Footer>
  ```

### Form Inputs (`.sheet-input`)
- **What:** Unified text/textarea styling.
- **CSS:**
  - `width: 100%; background: var(--card-soft); border: 1px solid var(--line-soft); border-radius: 8px; padding: 10px 14px; font-family: var(--font-sans); font-size: 13.5px; letter-spacing: -0.005em; color: var(--ink); outline: none; appearance: none`
  - Placeholder: `color: var(--muted); opacity: 0.7`
  - Focus: `border-color: var(--accent); background: var(--paper)`
- **Textarea:** `font-family: var(--font-mono); font-size: 12.5px; padding: 12px 14px; resize: vertical; min-height: 60px`
- **Pattern:**
  ```jsx
  <input
    type="text"
    className="sheet-input"
    placeholder="Search funds…"
    value={query}
    onChange={(e) => setQuery(e.target.value)}
  />
  ```

### Manual Row (`.manual-row`)
- **What:** Grid-based holding input row (symbol, quantity, cost).
- **CSS:**
  - `display: grid; grid-template-columns: minmax(0, 2fr) 1fr 1fr 28px; gap: 6px; margin-bottom: 6px; align-items: center`
  - Narrow: `minmax(0, 1.4fr) minmax(66px, 1fr) minmax(66px, 1fr) 22px`
- **Input:** `background: var(--card-soft); border: 1px solid var(--line-soft); border-radius: 8px; padding: 7px 10px; font-family: var(--font-sans); font-size: 12.5px; color: var(--ink); outline: none; min-width: 0; width: 100%`
- **Type badge (`.type-badge`):**
  - `position: absolute; top: 50%; right: 5px; transform: translateY(-50%); padding: 1px 5px; font-family: var(--font-sans); font-size: 9.5px; font-weight: 600; color: var(--muted); background: var(--paper); border: 1px solid var(--line-soft); border-radius: 5px`
  - Overridden: `color: var(--ink); border-color: var(--accent)`
- **Remove button:** `.icon-btn` sized 28px / 22px
- **Pattern:**
  ```jsx
  <div className="manual-row">
    <div style={{ position: "relative" }}>
      <input type="text" className="sheet-input" placeholder="Symbol" value={ticker} />
      {ticker && <span className="type-badge">TH</span>}
    </div>
    <input type="number" className="sheet-input" placeholder="Units" value={units} />
    <input type="number" className="sheet-input" placeholder="Cost" value={cost} />
    <button className="icon-btn quiet" onClick={onRemove}>
      <Icon name="trash" size={14} />
    </button>
  </div>
  ```

### Source Segmented Control (`.source-seg`)
- **What:** Bulk action to set all rows' price source (Thai fund | Stock/ETF).
- **CSS:**
  - `display: inline-flex; gap: 6px`
  - Buttons: `background: var(--card-soft); border: 1px solid var(--line-soft); color: var(--ink); font-family: var(--font-sans); font-size: 12px; font-weight: 500; padding: 5px 12px; border-radius: 7px; cursor: pointer; line-height: 1.4`
  - Hover: `border-color: var(--accent)`

### Transaction Row (`.txn-row`)
- **What:** Grid for bulk transaction importer (date, type, symbol, units, price, fee, amount).
- **CSS:**
  - `display: grid; gap: 6px; align-items: center; border: 1px solid var(--line-soft); border-radius: 10px; padding: 8px 10px; margin-bottom: 8px; background: var(--card-soft)`
  - Wide: `grid-template-columns: 124px 98px minmax(110px, 1.4fr) minmax(60px, 0.8fr) minmax(60px, 0.8fr) minmax(56px, 0.7fr) minmax(82px, 1fr) 28px`
  - Narrow (< 760px): `grid-template-columns: repeat(12, 1fr)` with grid placement per column
- **Inputs:** `.sheet-input` styling
- **Remove button (`.txn-row__remove`):** `background: transparent; border: 0; color: var(--muted); cursor: pointer; border-radius: 6px; justify-self: center; padding: 4px`

### Drop Zone (`.drop-zone`)
- **What:** Drag-and-drop area for image upload.
- **CSS:**
  - `border: 1.5px dashed var(--line); border-radius: 14px; padding: 28px 16px; text-align: center; background: var(--card-soft); cursor: pointer`
  - Hover: `border-color: var(--accent)`
- **Icon (`.drop-zone svg`):** `color: var(--muted); margin-bottom: 8px`
- **Title (`.dz-title`):** `font-size: 13.5px; font-weight: 500; margin-bottom: 4px`
- **Subtitle (`.dz-sub`):** `font-size: 11.5px; color: var(--muted)`
- **Pattern:**
  ```jsx
  <label className="drop-zone" onDrop={onDrop} onDragOver={onDragOver}>
    <Icon name="image" size={20} />
    <div className="dz-title">Drag & drop a screenshot</div>
    <div className="dz-sub">or click to browse</div>
    <input type="file" accept="image/*" onChange={onSelect} style={{ display: "none" }} />
  </label>
  ```

---

## 9. Empty States

### Activity / Journal Empty State
- **Container:** Center-aligned card.
- **Emoji/icon:** Large, centered (28px or text emoji).
- **Heading:** `font-size: 16px; font-weight: 500; letter-spacing: -0.02em; margin-bottom: 6px`
- **Description:** `font-size: 13px; color: var(--ink-soft); line-height: 1.5; margin-bottom: 20px; max-width: 280px`
- **Actions:** Flex column with `.btn` variants.
- **Pattern:**
  ```jsx
  <div className="card" style={{ padding: "32px 20px", textAlign: "center" }}>
    <div style={{ fontSize: 28, marginBottom: 8 }}>📋</div>
    <div style={{ fontSize: 16, fontWeight: 500, letterSpacing: "-0.02em", marginBottom: 6 }}>
      No transactions yet
    </div>
    <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, marginBottom: 20, maxWidth: 280, margin: "0 auto 20px" }}>
      Start recording your investments and trades to build your history.
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button className="btn primary" onClick={onAdd}>
        <Icon name="plus" size={13} /> Add Holding
      </button>
    </div>
  </div>
  ```

### Holdings Empty State (on Portfolio)
- **Text:** `color: var(--muted); font-size: 13px; padding: 24px; text-align: center`

---

## 10. Mono / Number Conventions

### Font Family (`.num`)
- **CSS:** `font-family: var(--font-mono); font-feature-settings: "tnum"; font-variant-numeric: tabular-nums`
- **Token:** `--font-mono: "Geist Mono", ui-monospace, "SF Mono", monospace`
- **Usage:** All currency, percentages, dates, units — anywhere alignment matters

### Money Format (฿)
- **Symbol:** Unicode `฿` (Thai baht, U+0E3F)
- **Helper function:**
  ```ts
  const baht = (n: number): string => `฿${Math.round(n).toLocaleString("en-US")}`;
  ```
- **Example:** `฿1,250,000` (no cents unless explicitly shown via `.cents` inside `.hero-value`)

### Decimal / Percentage Format
- **Helper (`fmtPct`):**
  ```ts
  export function fmtPct(n: number | null | undefined, decimals = 1): string {
    if (n == null) return "−";
    const sign = n >= 0 ? "" : "−";
    const pct = Math.abs(n) * 100;
    return `${sign}${pct.toFixed(decimals)}%`;
  }
  ```
- **Example:** `+12.5%` or `−3.2%`

### Date Format
- **Pattern:** "DD Mmm YYYY" (e.g., "12 Mar 2026")
- **Helper (from EventLine):**
  ```ts
  function fmtDate(iso: string): string {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  ```

### Relative Date
- **Helper (`fmtRelativeDate`):** Formats timestamps as "2 hours ago" or "3 days ago"

---

## 11. Color Tokens

### Light Theme (default)
```css
--bg: #f8f8f9;                     /* page background */
--paper: #ffffff;                  /* card / modal background */
--card-soft: #f1f2f4;             /* muted card, chip bg */
--ink: #0a0a0b;                   /* primary text */
--ink-soft: #3a3d43;              /* secondary text */
--muted: #7e828a;                 /* tertiary, disabled */
--muted-2: #a8acb2;               /* very light text */
--line: #e6e7ea;                  /* borders, dividers */
--line-soft: #eff0f2;             /* subtle lines */
--accent: #10a86b;                /* primary action (green) */
--accent-ink: #076339;            /* text on accent bg */
--accent-soft: #e3f6ec;           /* accent background tint */
--accent-2: #0aa694;              /* secondary green */
--accent-2-soft: #dcf1ed;         /* secondary green tint */
--gain: #10a86b;                  /* positive / gain text */
--loss: #d14545;                  /* negative / loss text */
--amber: #d89a1f;                 /* warning / fee color */
--info: #4c7ac9;                  /* informational */
--chip-bg: #f1f2f4;               /* filter chip bg */
--chip-active-bg: #ffffff;        /* active chip bg */
```

### Dark Theme (`[data-theme="dark"]`)
```css
--bg: #0c0d0f;
--paper: #16181b;
--card-soft: #101215;
--ink: #f4f5f7;
--ink-soft: #c5c8cd;
--muted: #7a7f87;
--muted-2: #595d63;
--line: #22252a;
--line-soft: #1b1e22;
--accent: #19c37d;                /* brighter green for dark */
--accent-ink: #19c37d;
--accent-soft: rgba(25, 195, 125, 0.14);
--gain: #19c37d;
--loss: #f46a6a;
--amber: #e4b440;
--info: #6e96e6;
--chip-bg: #1b1e22;
--chip-active-bg: #262a30;
```

### Shadows
```css
--shadow-sm: 0 1px 2px rgba(10, 10, 11, 0.04);
--shadow-md: 0 4px 24px -8px rgba(10, 10, 11, 0.08), 0 1px 2px rgba(10, 10, 11, 0.04);
--shadow-lg: 0 24px 48px -16px rgba(10, 10, 11, 0.16), 0 2px 4px rgba(10, 10, 11, 0.04);
```

### Border Radius
```css
--r-sm: 6px;
--r-md: 10px;
--r-lg: 14px;
--r-xl: 18px;
--r-2xl: 22px;
--r-full: 999px;
```

### Spacing
```css
--gap: 12px;          /* standard gap between flex items */
--pad-card: 16px;     /* card padding (12px in compact mode) */
```

---

## 12. How to Compose in This System

### Recipe A: Transaction Event List (Matching Holdings Rows)

Goal: Build a list of recent transaction events that feels native to the app.

```jsx
import { EventLine } from "@/components/history/EventLine";

export function RecentTransactionsList({ txns, onEdit }) {
  return (
    <div className="section">
      <div className="section-header">
        <h3>Recently Recorded</h3>
        <span className="link">See all</span>
      </div>
      <div className="card">
        {txns.length > 0 ? (
          txns.map(txn => (
            <EventLine
              key={`${txn.ticker}-${txn.tradeDate}`}
              txn={txn}
              realized={/* calculated gain if sell */}
              onOpen={() => onEdit(txn)}
            />
          ))
        ) : (
          <div style={{ padding: "20px 16px", color: "var(--muted)", textAlign: "center" }}>
            No transactions recorded yet.
          </div>
        )}
      </div>
    </div>
  );
}
```

**Key classes reused:**
- `.section` + `.section-header` — frame
- `.card` — container
- `.evline` — each row (imported EventLine component)
- `.link` — subtle right-side action
- `color: var(--muted)` — empty state text

---

### Recipe B: In-Context Summary / KPI Strip

Goal: Show portfolio metrics (Total, Change, Allocation health) inline between sections.

```jsx
export function PortfolioSummaryStrip({ portfolio }) {
  const gain = portfolio.value - portfolio.costBasis;
  const gainPct = portfolio.costBasis > 0 ? (gain / portfolio.costBasis) * 100 : 0;

  return (
    <div className="activity-recap">
      <div className="activity-recap__cell">
        <div className="activity-recap__label">TOTAL VALUE</div>
        <div className="activity-recap__value">
          ฿{(portfolio.value / 1000000).toFixed(1)}M
        </div>
        <div className="activity-recap__caption">Portfolio total</div>
      </div>

      <div className="activity-recap__cell">
        <div className="activity-recap__label">GAIN / LOSS</div>
        <div className="activity-recap__value" style={{
          color: gain >= 0 ? "var(--gain)" : "var(--loss)"
        }}>
          {gain >= 0 ? "+" : ""}฿{Math.abs(gain / 1000).toFixed(1)}K
        </div>
        <div className="activity-recap__caption">{gainPct >= 0 ? "+" : ""}{gainPct.toFixed(1)}%</div>
      </div>

      <div className="activity-recap__cell">
        <div className="activity-recap__label">FEES (ANNUAL)</div>
        <div className="activity-recap__value">
          {portfolio.annualFees.toFixed(2)}%
        </div>
        <div className="activity-recap__caption">Weighted avg</div>
      </div>

      <div className="activity-recap__cell">
        <div className="activity-recap__label">HOLDINGS</div>
        <div className="activity-recap__value">
          {portfolio.holdings.length}
        </div>
        <div className="activity-recap__caption">Count</div>
      </div>
    </div>
  );
}
```

**Key classes reused:**
- `.activity-recap` — grid container (auto-fit columns, 120px min)
- `.activity-recap__cell` — each KPI block
- `.activity-recap__label` — mono uppercase label
- `.activity-recap__value` — large headline number
- `.activity-recap__caption` — sub-text, clamped to 2 lines
- `color: var(--gain) | var(--loss)` — conditional styling

---

### Recipe C: Add / Import Modal (Matching Existing Sheet Pattern)

Goal: Build an import modal that mirrors the AddHoldingsSheet structure.

```jsx
import { Modal } from "@/components/Modal";
import { Icon } from "@/components/Icon";

export function ImportTransactionsModal({ open, onClose, onImport }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [method, setMethod] = React.useState<"csv" | "image">("csv");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null);
  };

  const handleImport = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("method", method);
    const res = await fetch("/api/import/transactions", { method: "POST", body: formData });
    const data = await res.json();
    onImport(data.rows);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} variant="form">
      <Modal.Header>
        <div className="modal-header-text">
          <h2 className="modal-title">Import Transactions</h2>
          <p className="modal-subtitle">Upload a CSV or screenshot of your transaction history</p>
        </div>
        <button className="icon-btn quiet modal-close" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </Modal.Header>

      <Modal.Body>
        {/* Method selector */}
        <div className="method-tabs">
          <button data-active={method === "csv"} onClick={() => setMethod("csv")}>
            CSV
          </button>
          <button data-active={method === "image"} onClick={() => setMethod("image")}>
            Screenshot
          </button>
        </div>

        {/* File input */}
        <label className="drop-zone">
          <Icon name="image" size={20} />
          <div className="dz-title">
            {method === "csv" ? "Select a CSV file" : "Drag & drop a screenshot"}
          </div>
          <div className="dz-sub">
            {method === "csv"
              ? "Headers: Date, Symbol, Type, Units, Price, Fee"
              : "or click to browse"}
          </div>
          <input
            type="file"
            accept={method === "csv" ? ".csv" : "image/*"}
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
        </label>

        {/* Preview */}
        {file && (
          <div style={{ marginTop: 16, padding: "12px", background: "var(--card-soft)", borderRadius: "var(--r-md)" }}>
            <span className="num" style={{ fontSize: 12, color: "var(--muted)" }}>
              {file.name}
            </span>
          </div>
        )}

        <div className="modal-body-sentinel" />
      </Modal.Body>

      <Modal.Footer>
        <div className="modal-footer-end">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={handleImport} disabled={!file}>
            <Icon name="upload" size={13} /> Import
          </button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
```

**Key classes reused:**
- `.modal` + `.modal-header` + `.modal-body` + `.modal-footer` — structure
- `.modal-title` + `.modal-subtitle` — header text
- `.icon-btn quiet` — close button
- `.method-tabs` — CSV vs Image toggle
- `.drop-zone` — file input area
- `.modal-body-sentinel` — scroll indicator trigger
- `.btn.ghost` + `.btn.primary` — footer actions (auto right-align via margin-left: auto)
- `className="num"` — monospace file name

---

## Summary of High-Reuse Classes

Use these patterns for maximum visual cohesion:

| Pattern | Classes | Use Case |
|---------|---------|----------|
| Screen frame | `.screen`, `.topbar`, `.brand`, `.sub-tabs` | Any full-screen view |
| Section + header | `.section`, `.section-header`, `<h3>`, `.link` | Major groupings with right-side action |
| Card container | `.card` or `.card-soft` | Any grouped content block |
| Holdings-style row | `.holding` (grid: swatch, name/sub, value/pct) | Dense list of items with visual swatch |
| Transaction event | `.evline` (gutter mark, date·verb·ticker, detail, amount) | Timeline of events, statement-like |
| KPI/recap grid | `.activity-recap` (auto-fit cells with label/value/caption) | Summary metrics strip |
| Form inputs | `.sheet-input` | Text, textarea, search |
| Modal | `.modal` + Header/Body/Footer | Dialogs, forms, detail views |
| Buttons | `.btn.primary`, `.btn.ghost`, `.btn.sm`, `.icon-btn` | Actions |
| Chips/filters | `.filter-chips` + `.chip` or `.method-tabs` | Toggle states, method selection |
| Empty state | `.card` + emoji + heading + text + buttons | No-data fallback |
| Delta/change | `.delta.up` / `.delta.down`, `.delta-pill` | Gain/loss indication |
| Monospace numbers | `.num` + `tabular-nums` | Currency, percentages, dates |

---

## Quick Color Reference

**DO use:**
- `var(--gain)` for positive numbers, upward movement
- `var(--loss)` for negative numbers, losses
- `var(--amber)` for warnings, fees, costs
- `var(--accent)` for primary CTAs, highlights
- `var(--muted)` for secondary text, disabled state
- `var(--paper)` / `var(--card-soft)` for backgrounds
- `var(--ink)` for body text, `var(--ink-soft)` for secondary

**DON'T use hardcoded colors.** All colors are tokens and theme-aware (light/dark mode).

---

**Last updated:** 2026-06-04 | Synced with app/globals.css, components/*.tsx, real production patterns
