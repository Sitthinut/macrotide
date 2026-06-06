# API routes

Catalog of the Next.js App Router route handlers under
[`app/api/`](../../app/api). This is a hand-maintained map; the route files
themselves are the source of truth for exact request/response shapes.

> **Convention.** Every handler that reads or writes the database runs inside
> `withDb`, which routes the query to the owner DB or the per-session demo DB
> based on the `macrotide_demo` cookie. See
> [architecture § owner vs demo databases](../explanation/architecture.md#owner-vs-demo-databases)
> and [AGENTS.md § DB routing](../../AGENTS.md#db-routing--read-this-before-touching-any-route-handler).

## Portfolio data

| Route | Methods | Purpose |
|---|---|---|
| `/api/buckets` | GET, POST | List / create investment buckets (portfolio slices) |
| `/api/buckets/[id]` | GET, PATCH, DELETE | Read / update / delete a bucket |
| `/api/holdings` | GET, POST | List positions / add one. POST writes an `opening` anchor to the ledger; the holding is its projection ([ADR 0004](../explanation/decisions/0004-unified-ledger-positions-derived.md)) |
| `/api/holdings/[id]` | GET, PATCH, DELETE | Read / edit / delete. PATCH edits the single backing event in place (or appends a `snapshot` for multi-event positions); metadata updates the row; DELETE removes the ticker's ledger events |
| `/api/transactions` | GET, POST | List / batch-add ledger transactions (bucket-scoped). POST accepts trade deltas **and** position anchors (`opening`/`snapshot`, both shown as a "Balance"); an anchor or a split may carry `amount` 0. An optional per-row `marketPrice` records the asset's current price (custom-asset pricing). Repeat anchors for a fund auto-promote (the first is `opening`, later ones become `snapshot`) so a later balance re-bases units without double-counting. Sign derived from `kind`; every write rebuilds the affected buckets' derived holdings |
| `/api/transactions/[id]` | PATCH, DELETE | Edit / delete a single ledger event (the inline-edit path); rebuilds the bucket's holdings. PATCH also accepts `marketPrice` (a Balance's current price). Amount sign is re-derived server-side from `kind` |
| `/api/transactions/analytics` | GET | Realized gains, money-weighted return (XIRR), cost-basis timeline. Scoped to the caller's buckets; an optional `?ticker=` narrows it to one instrument for a Position page |
| `/api/plan` | GET, PUT | Read / replace the investment plan (markdown) |
| `/api/plan/edit` | POST | Apply an Advisor-proposed plan edit (`applyPlanEdit` + upsert) |
| `/api/journal` | GET, POST | List / create journal entries |
| `/api/journal/[id]` | GET, PATCH, DELETE | Read / update / delete a journal entry |
| `/api/models` | GET, POST | List / create model portfolios |
| `/api/models/[id]` | GET, PATCH, DELETE | Read / update / delete a model portfolio |
| `/api/analysis` | GET | Portfolio health / composite score |
| `/api/portfolios/series` | GET | Portfolio value time series (for charts) |
| `/api/settings` | GET, PUT | Read / write key-value settings |

## Market data

| Route | Methods | Purpose |
|---|---|---|
| `/api/quotes` | GET | Latest NAV / price quotes for tickers |
| `/api/market/indices` | GET | SET + global index levels and deltas |
| `/api/market/news` | GET | Market news (RSS) |
| `/api/admin/refresh-market` | GET, POST | Trigger a market data refresh (admin) |

## Funds & screener

| Route | Methods | Purpose |
|---|---|---|
| `/api/funds` | GET | Parent fund catalog, filtered + cheapest-TER first (the advisor `find_funds` view) |
| `/api/fund-classes` | GET | Priceable **share classes** for the Explore screener (per-class fee / tax / NAV / 1Y return / fund size; searchable by class ticker; ranked most-popular-first; hides institutional/insurance by default) |
| `/api/fund-classes/resolve` | GET | Validate a ticker — is it a priceable class, or a parent with multiple classes |
| `/api/funds/[projId]` | GET | Fund detail + enrichment + share classes (accepts a proj_id, parent abbr, or class ticker) |
| `/api/funds/[projId]/series` | GET | Daily NAV + AUM history for one share class (`range` param) |

## Chat & Advisor

| Route | Methods | Purpose |
|---|---|---|
| `/api/chat` | POST | Streaming chat; injects memory, runs Advisor tool-calls |
| `/api/chat/threads` | GET, POST | List / create chat threads |
| `/api/chat/threads/[id]` | GET, PATCH, DELETE | Read / rename / soft-delete a thread |
| `/api/chat/threads/[id]/title` | POST | Auto-title a thread after its first exchange |
| `/api/chat/threads/[id]/close` | POST | Close a session → extract memory + mark idle |
| `/api/chat/search` | GET | Full-text search across the user's chats |
| `/api/import/image` | POST | OCR an import screenshot. Auto-classifies holdings-snapshot vs transaction-history, then runs the matching extractor; returns `{ docType, confidence, holdings? \| transactions? }` so the client can confirm a low-confidence guess. An optional `as=holdings\|transactions` form field skips detection (used when the user picks). Needs `OPENROUTER_API_KEY` (503 without) |
| `/api/import/transactions-image` | POST | OCR a transaction-history image into ledger rows directly (same key + rate limit + 5 MB cap as `/api/import/image`) |

## Memory

| Route | Methods | Purpose |
|---|---|---|
| `/api/memory/preferences` | GET | List active stored preferences |
| `/api/memory/preferences/[id]` | POST, DELETE | Restore / delete a preference (30-day trash) |

See the [memory feature guide](../explanation/memory.md) for the model behind these.

## Auth, account & demo

| Route | Methods | Purpose |
|---|---|---|
| `/api/auth/[...all]` | (better-auth) | All better-auth endpoints (sign-in, sign-up, passkey, OAuth callbacks); IP-rate-limited via `AUTH_RATE_LIMIT` |
| `/api/auth-config` | GET | Which auth methods are enabled (drives the `/login` UI; exposes the public Turnstile site key) |
| `/api/account/usage` | GET | Per-user token usage against the daily budget |
| `/api/demo` | POST, DELETE | Start / end a demo session (sets / clears the `macrotide_demo` cookie) |
