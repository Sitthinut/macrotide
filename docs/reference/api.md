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
| `/api/holdings` | GET, POST | List / add fund positions |
| `/api/holdings/[id]` | GET, PATCH, DELETE | Read / update / delete a holding |
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

## Chat & Advisor

| Route | Methods | Purpose |
|---|---|---|
| `/api/chat` | POST | Streaming chat; injects memory, runs Advisor tool-calls |
| `/api/chat/threads` | GET, POST | List / create chat threads |
| `/api/chat/threads/[id]` | GET, PATCH, DELETE | Read / rename / soft-delete a thread |
| `/api/chat/threads/[id]/title` | POST | Auto-title a thread after its first exchange |
| `/api/chat/threads/[id]/close` | POST | Close a session → extract memory + mark idle |
| `/api/chat/search` | GET | Full-text search across the user's chats |
| `/api/import/image` | POST | OCR-transcribe a holdings image (needs `OPENROUTER_API_KEY`; 503 without) |

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
