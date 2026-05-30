# Import a portfolio

Use the **Add holdings** sheet on the **Connect** screen. Paste/CSV and Image
are import helpers; everything lands in one editable review table, where you
can also type rows directly before saving.

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

## How quotes get attached

Each holding stores a `quote_source` that routes NAV/price lookups to the right
provider (Thai SEC Open API for Thai mutual funds, Yahoo Finance for everything
else). The user-visible ticker stays bare; routing lives in a separate column.
Details: [AGENTS.md § Provider routing](../../AGENTS.md#provider-routing-via-holdingsquote_source).
