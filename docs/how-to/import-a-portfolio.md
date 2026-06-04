# Import a portfolio

Use the **Add to portfolio** sheet (one entry point with a **Holdings ↔
Activity** toggle in its header). **Holdings** records a snapshot of what you
hold now; **Activity** records a buy/sell history. Both write to the same
ledger — holdings are a projection of it
([ADR 0004](../explanation/decisions/0004-unified-ledger-positions-derived.md)).
This page covers the Holdings (snapshot) side; the
[Transaction history](#transaction-history) section below covers Activity.

Paste/CSV and Image are import helpers; everything lands in one editable review
table, where you can also type rows directly before saving.

## Editable review table

Every import path feeds the same table. Type directly into a blank row, or edit
rows created by paste/CSV/image extraction. As you type a symbol, the field
autocompletes against a seed list of known funds
([lib/data/known-funds.ts](../../lib/data/known-funds.ts)), filling in names and
asset class where it can. Duplicate symbols are de-duped into the existing row
for review rather than creating a second row.

The table stores the canonical holding fields: symbol, quantity, and average
cost. Quantity is required to save a row; average cost is optional.

Best for: a handful of positions, or correcting an import before saving.

## Paste / CSV import

Paste rows or upload a CSV/text file of your holdings. Columns map to symbol,
quantity, average cost, and the fields the Portfolio screen needs. Rows are
validated in the review table before they're saved.

Best for: exporting from a spreadsheet or brokerage statement you already have
in tabular form.

## Image OCR

Upload one or more screenshots/photos of your holdings. Each image is sent to a
vision model via OpenRouter ([POST /api/import/image](../reference/api.md)),
which returns **structured rows** shown as an **editable confirmation table** —
you review and edit before anything saves.

Most Thai broker apps show market value + allocation %, not units. Where a
fund's NAV is on file, the importer derives units (`value ÷ NAV`) and average
cost and marks them estimated (dashed field); rows it can't derive are
highlighted for you to fill in — open the fund's detail view for exact units +
average cost. Upload several screenshots and the rows merge (a later detail-view
shot backfills exact figures over an earlier summary).

Requirements and behavior:

- Needs `OPENROUTER_API_KEY`. Without it the endpoint returns **503** with a
  message pointing you at the key. See [auth-and-providers.md](../reference/auth-and-providers.md).
- Uses a vision model by default (`OCR_MODEL`, `google/gemini-2.5-flash`) with an
  automatic fallback on provider/rate-limit errors. Not tier-gated — the same
  model serves every user. Both are configurable — see the
  [env-var table](../../AGENTS.md#ai--model-selection).
- The screenshot is read once and never stored.

Best for: a statement you only have as an image or screenshot.

> **A note on data hygiene.** This is a personal investing app. When testing or
> contributing, use placeholder fund codes (`EXAMPLE-FUND-A`), never real ones —
> see [AGENTS.md § Personal data](../../AGENTS.md#personal-data--never-commit).

## Transaction history

The Holdings mode records a **snapshot** — what you hold *now* (stored as a
single `opening` event). The **Activity** mode records a dated log of buys,
sells, and dividends, the raw material for realized gains, your return, and a
contribution timeline. Switch to it with the **Activity** toggle in the
**Add to portfolio** header for a bulk import, or open the **Activity** view (the
*Activity* button in the Portfolio screen's Holdings header), where you can add,
edit, or delete any ledger row in place (the starting-balance row included).

Feed a bulk import the same two ways — **Paste / CSV** (`date, type, ticker,
units, price, amount` per row) or an **image** of a buy/sell log — into one editable
confirmation table. Each row carries a date, a type (buy / sell / dividend / fee
/ split / reinvest), and an amount; rows are kept separate (a buy and a later
sell of the same fund are two events, never merged). You enter the amount as a
positive figure; the app records the direction from the type.

Both modes write to one ledger, so they can never contradict each other: your
holdings *are* the replay of these events. Editing a holding's units or average
cost edits the backing event (or records a `snapshot` restatement); a position
with no average cost shows a quiet "add to see gains & return" nudge rather than
a misleading figure.

From the ledger, the Activity view shows:

- **Realized gains** on your sells, using **average cost** (FIFO is available);
  the cost basis of sold units is removed proportionally, never by the sale
  proceeds.
- **Money-weighted return (XIRR)** — the rate that accounts for *when* you added
  cash, shown in THB. It appears once there's enough history and a current price
  for everything you still hold; until then you'll see a short "not enough
  activity yet" note rather than a misleading number.
- **A cost-basis-over-time timeline** of what you've put in.

If you paste a transaction history into the **Holdings** mode by mistake, it
notices (the same fund appears on several rows) and offers to switch you to
**Activity**, carrying your rows over rather than collapsing your trades into one
position.

> Realized-gain and holding-period figures are **for information only — not
> investment advice, and not a tax statement.** Capital gains on Thai mutual-fund
> units are generally tax-exempt for individuals; tax-wrapper holding-period
> rules (SSF / RMF) are policy-dependent.

Why one ledger with positions derived from it (and how the snapshot and event
flows unify)? See
[ADR 0004 — unified ledger, positions derived](../explanation/decisions/0004-unified-ledger-positions-derived.md).

## How quotes get attached

Each holding stores a `quote_source` that routes NAV/price lookups to the right
provider (Thai SEC Open API for Thai mutual funds, Yahoo Finance for everything
else). The user-visible ticker stays bare; routing lives in a separate column.
Details: [AGENTS.md § Provider routing](../../AGENTS.md#provider-routing-via-holdingsquote_source).
