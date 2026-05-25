# Import a portfolio

Three ways to get holdings into Macrotide, from quickest to most hands-on. All
live under the **Connect** screen.

## Manual entry (with autocomplete)

Add holdings one at a time. As you type a ticker, the field autocompletes
against a seed list of known funds ([lib/data/known-funds.ts](../../lib/data/known-funds.ts)),
filling in names and asset class where it can. Duplicate tickers are de-duped
into the existing holding rather than creating a second row.

Best for: a handful of positions, or correcting an import.

## CSV import

Upload a CSV of your holdings. Columns map to ticker, units, average cost, and
the fields the Portfolio screen needs. Rows are validated before they're saved.

Best for: exporting from a spreadsheet or brokerage statement you already have
in tabular form.

## Image OCR

Upload a screenshot or photo of a holdings statement. The image is sent to a
vision model via OpenRouter ([POST /api/import/image](../reference/api.md)),
which **transcribes the raw text** — it does not yet parse structured rows for
you; you review and confirm what it read.

Requirements and behavior:

- Needs `OPENROUTER_API_KEY`. Without it the endpoint returns **503** with a
  message pointing you at the key. See [auth-and-providers.md](../reference/auth-and-providers.md).
- Uses a free OCR model by default (`OCR_MODEL`, `baidu/qianfan-ocr-fast:free`)
  with an automatic paid fallback on quota/rate-limit. Both are configurable —
  see the [env-var table](../../AGENTS.md#ai--model-selection).

Best for: a statement you only have as an image or PDF screenshot.

> **A note on data hygiene.** This is a personal investing app. When testing or
> contributing, use placeholder fund codes (`EXAMPLE-FUND-A`), never real ones —
> see [AGENTS.md § Personal data](../../AGENTS.md#personal-data--never-commit).

## How quotes get attached

Each holding stores a `quote_source` that routes NAV/price lookups to the right
provider (Thai SEC Open API for Thai mutual funds, Yahoo Finance for everything
else). The user-visible ticker stays bare; routing lives in a separate column.
Details: [AGENTS.md § Provider routing](../../AGENTS.md#provider-routing-via-holdingsquote_source).
