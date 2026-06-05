# Feedback 03 — The portfolio-wide view: don't bury the headline in a sub-tab

> Lens: consumer-fintech product designer (Copilot / Robinhood / Monarch). The
> question on the table: spec 05's **"Performance" sub-tab** as the home for the
> portfolio-wide headline + trends + all-activity feed, futureproofed for #35/#36.
> Settled and not relitigated here: per-position drill-in pages, the dead modal
> toggle, snapshot-vs-activity auto-detect, fixed backend.

## 1. Verdict on the sub-tab — **MODIFY (mostly kill)**

The instinct behind the sub-tab is right (don't dump the whole feed on top of the
Holdings list) but the *fix* is wrong. The single most important number in this
entire app — **"how's my money?"** — is being filed behind a tab the user has to
discover and tap. That's the one thing a money app must never do. Open Copilot,
Monarch, or Robinhood and the answer to "how am I doing?" is the first thing your
eye lands on, before any navigation. A sub-tab makes the headline a *destination*
instead of the *welcome*.

The actual problem spec 05 diagnosed — "the portfolio-wide feed overloads the
Portfolio screen" — is real, but the feed is the heavy part, **not the headline**.
So split them:

- **Promote the headline + a calm summary to the DEFAULT Portfolio view** (above
  the holdings strip). It costs ~3 lines. It is never overload.
- **Demote only the heavy, on-demand stuff** — the full reverse-chron all-activity
  feed, the trends charts, and the future #35/#36 planners — to a second tab.
  Rename it from the vague "Performance" to **"Activity"** (or "History &
  Trends"), because what lives there is the feed + analysis, and "Performance" is
  a number the user expects *up front*, not a place they navigate to.

So: keep a second tab for the heavy feed; **kill the idea that the headline lives
inside it.** The headline is home.

## 2. The ideal portfolio-wide view

### DEFAULT (calm / glanceable) — the Portfolio landing

```
┌─ Portfolio ──────────────────────────────────────────────────────────────┐
│  [ Holdings ]   Activity                                         [ + Add ] │
│  ──────────────────────────────────────────────────────────────────────── │
│                                                                            │
│   YOUR MONEY                                                               │  ← small-caps mono label
│   ฿1,430,700  value                                                        │  ← THE headline. biggest thing on screen
│   ▲ ฿146,200 total return (+11.4%)  ·  +9.4% IRR                          │  ← one supporting line, green if up
│   ▁▂▃▄▅▆▇█  18 months                                       [ Trends ▸ ]   │  ← one calm sparkline + disclosure
│                                                                            │
│  ── Holdings ──────────────────────────────────────────────────────────── │
│   ● EXAMPLE-FUND-A     ฿612,000   +12.1%   ▕▔▔▔▔▔▔▏ 48%                  → │
│   ● K-EQUITY           ฿404,000    +6.8%   ▕▔▔▔▏    31%                  → │
│   ● SCBSET             ฿268,000    −2.0%   ▕▔▔▏     21%                  → │
│   + cash / other       ฿146,700              ▕▏      ...                   │
│                                                                            │
│   ──────────────────────────────────────────────────────────────────────  │
│   Recently                                                                 │  ← a 3-item TAIL, not the full feed
│   ↑ Bought EXAMPLE-FUND-A   ฿50,000   12 Jun                              → │
│   ↓ Sold   K-EQUITY         ฿30,000   8 Jun    ⤷ +฿4,200 banked          → │
│   ◆ Dividend SCBSET         +฿1,150   3 Jun                              → │
│                                              [ See all activity → ]        │  ← into the Activity tab
└────────────────────────────────────────────────────────────────────────────┘
```

The whole default answers three questions top-to-bottom: *how's my money?*
(headline) → *what do I hold?* (strip) → *what just happened?* (3-item tail). No
charts open, no 41-row feed, no planners. Three lines of summary, the existing
holdings list, a short recent tail. That is calm, and it is buildable today.

### MORE-INFO (expanded) — Trends open + the Activity tab

Tapping `[ Trends ▸ ]` expands in place under the headline (still on the default
view) — no navigation:

```
│   ▲ ฿146,200 total return (+11.4%)  ·  +9.4% IRR                          │
│   ▾ Trends                                                                 │
│     ┌ value vs cost basis ─────────┐  ┌ net invested / month ───────────┐ │
│     │ value ──────────╱╲────╱       │  │ ▃▅▂▆▃▇                          │ │
│     │ basis ····__---‾‾‾‾‾‾         │  │                                 │ │
│     └──────────────────────────────┘  └─────────────────────────────────┘ │
│     realized ฿146,200 banked  ·  invested ฿1,284,500  ·  income ฿38,400   │  ← the stats line, on demand
```

Tapping `[ See all activity → ]` (or the Activity tab) opens the heavy view —
this is where spec 05's full module stack lives, correctly demoted:

```
┌─ Portfolio ──────────────────────────────────────────────────────────────┐
│  Holdings   [ Activity ]                                          [ + Add ] │
│  ──────────────────────────────────────────────────────────────────────── │
│   ฿146,200 realized  ·  +9.4% IRR · money-weighted  ·  over 18 mo   [▸Trends]│  ← thin recap bar, not the hero
│                                                                            │
│   ── All activity ──────────────────  [ All funds ▾ ]  [ All types ▾ ]    │  ← filters live HERE, where audit happens
│   JUNE 2026                                                                 │
│   ┌──────────────────────────────────────────────────────────────────┐    │
│   │  ↑  Bought  EXAMPLE-FUND-A                          ฿50,000       │    │
│   │     12 Jun · 1,000 units @ ฿50.00 · Broker X                     │    │
│   └──────────────────────────────────────────────────────────────────┘    │
│   ┌──────────────────────────────────────────────────────────────────┐    │
│   │  ↓  Sold  K-EQUITY                                 ฿30,000       │    │
│   │     8 Jun · 600 @ ฿50.00       ⤷ Realized +฿4,200  banked        │    │
│   └──────────────────────────────────────────────────────────────────┘    │
│   ◆  Dividend  SCBSET   3 Jun · paid to cash             +฿1,150           │
│   MAY 2026                                                                  │
│   ⚑  Starting balance  EXAMPLE-FUND-A  1 May · 10,000 u · avg ฿50  ฿500,000│
│                                                                            │
│   · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · │
│   ▸ Backtest a mix   (#35, later)        ▸ Wealth outlook   (#36, later)   │
└────────────────────────────────────────────────────────────────────────────┘
```

## 3. What I borrow from Design 01's main view

- **The headline number** — 01's bold one-number-plus-one-line is the spine. I
  move it from "invested" to **"value"** as the lead (the emotional answer to
  "how's my money?" is what it's *worth now*, not what I put in), with total
  return + IRR as the supporting line. Invested moves into the Trends stat row.
- **The standings / holdings strip** — borrowed almost verbatim and kept on the
  default view, exactly where 01 floated it above the feed. It *is* the holdings
  tab content; here it lives directly under the headline so the projection-of-one-
  ledger story reads top to bottom.
- **The reverse-chron card feed** — borrowed whole, but only the **3-item
  "Recently" tail** rides on the default. The full month-grouped feed (01's main
  body) moves to the Activity tab so the landing stays calm.
- **The "banked" green tail on sells** — borrowed exactly; it's the one flash of
  green, and it appears in both the Recently tail and the full feed.
- **The Trends disclosure** — borrowed as 01 designed it (folded by default, one
  tap reveals house-style sparklines), but placed under the *headline* on the
  default view, so the analysis is one tap from home, not one tab away.

The net: 01's main view *is* my default Portfolio screen, lightly compressed (full
feed → 3-item tail). The Activity tab is just "01's feed at full length, plus
filters and the future planners."

## 4. The progressive-disclosure ladder

| Level | What's visible | Cost |
| --- | --- | --- |
| **At rest** (Portfolio default) | Headline (value, return, IRR), one sparkline, holdings strip, 3-item Recently tail | the welcome — calm |
| **One tap — `Trends ▸`** | Value-vs-basis + net-invested charts, realized/invested/income stat line | expands in place, no nav |
| **One tap — `See all activity →` / Activity tab** | Full month-grouped feed, fund + type filters, recap bar | the audit surface |
| **One tap — any event card** | Inline editor (date/type/units/price/fee/source/note) | edit in place |
| **One tap — a holding `→`** | `/portfolio/[ticker]`: running total + that fund's ledger | the drill-in (settled) |

The rule: **nothing that overwhelms is ever on by default.** Charts, the long feed,
filters, and planners all sit exactly one deliberate tap below the calm surface.

## 5. How #35 / #36 appear without crowding the default

They live **only in the Activity tab**, as the reserved sibling slots spec 05
already drew (`▸ Backtest a mix`, `▸ Wealth outlook`) — collapsed teasers at the
bottom of the heavy view. The glanceable Portfolio default never mentions them.
When they ship, the Activity tab's segmented control can grow to
`History | Backtest | Outlook` (spec 05's graduation path, intact). The futureproof
container survives my change *better*, because demoting the heavy stuff to its own
tab is exactly the room those planners need — they'd have suffocated stacked under
a Holdings list, and they'd have made a headline-bearing sub-tab incoherent. The
calm landing is decoupled from the lab.

## 6. One honest tradeoff

Splitting "headline on the default view" from "feed in a tab" means the
**all-activity feed loses its bold headline** — the Activity tab opens on a thin
recap bar, not a hero number. A user who taps straight to Activity to review
history sees a slightly flatter, more utilitarian screen than 01's gorgeous
headline-over-feed. I accept that: the feed-with-hero belongs on the *position*
page and the *landing*, and the Activity tab's job is scanning and auditing, where
filters and density matter more than a second copy of the headline. One hero
number, in the one place every user lands — not two competing heroes on two tabs.
