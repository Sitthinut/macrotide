# Architecture

*Last updated: 2026-05-24*

How Macrotide is put together, and why it's shaped this way. For the working
rules an agent must follow when editing (the `withDb` contract, streaming
context re-entry, the `server-only` boundary), see [AGENTS.md](../../AGENTS.md) —
this page builds the mental model those rules sit on.

## The shape: one process, one file

Macrotide is **a single Next.js process talking to a local SQLite file.** No
separate database service, no message broker, no cache layer. The smallest
viable deploy is one small VM with a reverse proxy for TLS.

This is a deliberate choice for a personal-scale app: it keeps operations
trivial (back up one file), keeps latency low (in-process DB reads), and keeps
the whole thing comprehensible. The trade-offs — single-writer SQLite, no
horizontal scaling, in-memory rate limits — are acceptable until there are real
users, and are documented in [SECURITY.md](../../SECURITY.md) and
[deploy.md](../how-to/deploy.md).

```text
Browser ──HTTPS──▶ Reverse proxy (Caddy) ──▶ Next.js (App Router) ──▶ SQLite file
                                                   │
                                                   └──▶ OpenRouter (AI), Yahoo / Thai SEC (market data)
```

## Layers

| Layer | Lives in | Responsibility |
|---|---|---|
| **UI** | [components/](../../components) | Screens (Portfolio, Markets, Chat, Journal, Models, Connect, Settings, Account) and shared components. Client-rendered; never imports server-only code or mock data directly. |
| **Client data** | [lib/fetchers/](../../lib/fetchers) | SWR fetchers — the only way components reach the API. |
| **API** | [app/api/](../../app/api) | Route handlers. Validate, run inside `withDb`, call queries. See [api reference](../reference/api.md). |
| **Domain logic** | [lib/portfolio/](../../lib/portfolio), [lib/market/](../../lib/market), [lib/memory/](../../lib/memory), [lib/advisor/](../../lib/advisor), [lib/ai/](../../lib/ai) | Pure-ish helpers and integrations: analytics, market providers, memory, Advisor tools, model provider. |
| **Persistence** | [lib/db/](../../lib/db) | Drizzle client, [schema](../../lib/db/schema.ts), migrations, and all queries (`server-only`). |
| **Auth** | [lib/auth/](../../lib/auth) | better-auth singleton, session helpers, providers. |
| **Content** | [lib/static/](../../lib/static) | Editorial strings and placeholder analytics, shipped in the bundle. |

A strict boundary: **components never import `lib/db/queries/*` or
`lib/mock/data`.** They go through a fetcher → API route → query. Queries are
gated by `import "server-only"` because `better-sqlite3` is Node-native.

## Owner vs demo databases

The one piece of cleverness worth internalising. Macrotide serves two kinds of
traffic from the same code:

- **Owner** — the authenticated user; data persists in the file at `DB_PATH`.
- **Demo** — anyone who clicked *Try the demo*; gets a private, **in-memory**
  SQLite seeded from [lib/mock/demo-seed.ts](../../lib/mock/demo-seed.ts), keyed
  by the `macrotide_demo` cookie, swept after 1h idle, capped at 10 chat turns.

`withDb` ([lib/api/with-db.ts](../../lib/api/with-db.ts)) reads the demo cookie
and opens an `AsyncLocalStorage` scope so every `getDb()` call inside it routes
to the right database automatically. **Any route that queries must run inside
`withDb`**, or demo writes would leak into the owner DB.

The subtle case: `streamText`'s `onFinish` callback fires *after* `withDb`
returns, so the chat route captures the context and re-enters it with
`runWithDbContext`. This pattern is mandatory for any deferred write — the
canonical example is [app/api/chat/route.ts](../../app/api/chat/route.ts), and
the rule is spelled out in
[AGENTS.md](../../AGENTS.md#streaming--callbacks--re-enter-the-context).

## Request lifecycle (a typical read)

1. A screen renders and its SWR fetcher GETs an API route.
2. The route handler wraps its body in `withDb`, which resolves owner-vs-demo
   from the cookie.
3. Inside, it calls a query from `lib/db/queries/*`, which runs against the
   scoped SQLite.
4. JSON comes back; SWR caches it and the component renders.

Writes follow the same path with POST/PATCH/DELETE and revalidation.

## The chat path

`POST /api/chat` is the most involved route:

1. Resolve the model provider by tier and demo status ([lib/ai/provider.ts](../../lib/ai/provider.ts)).
   Free/demo traffic is pinned to the free model chain in code so it can never
   resolve to a paid model.
2. Inject the user's active memory into the system prompt
   ([lib/memory/inject.ts](../../lib/memory/inject.ts)), frozen for the session.
3. Stream the response with the Advisor's tool surface available
   ([lib/advisor/tools.ts](../../lib/advisor/tools.ts), [lib/memory/tools.ts](../../lib/memory/tools.ts)) —
   reading portfolio/plan/journal, proposing plan edits, saving preferences.
4. On finish (re-entering the DB context), persist the turn, meter usage, and —
   on session close — extract durable facts into memory.

The full memory + session-lifecycle design is its own document:
[features/memory.md](./memory.md).

## Market data

Holdings carry a `quote_source` routing key. A provider **registry**
([lib/market/registry.ts](../../lib/market/registry.ts)) dispatches NAV/price
fetches to the matching provider (Thai SEC Open API for Thai mutual funds,
Yahoo Finance otherwise), with a cache layer in front. The routing key names the
*asset class*, not the provider, so swapping a provider only touches the
registry. Adding one is a documented four-step recipe in
[AGENTS.md § Provider routing](../../AGENTS.md#provider-routing-via-holdingsquote_source).

## Where it lives

A quick index from concept to code (reciprocates the `see docs/...` comments in
the source):

```text
app/api/                  HTTP route handlers (run inside withDb)
app/(auth)/login/         Passkey / OAuth / demo sign-in screen
components/screens/        The seven app screens + Account
components/                Shared UI, charts, sheets, thread list
lib/api/with-db.ts         Owner-vs-demo DB routing (AsyncLocalStorage)
lib/db/schema.ts           The data model (source of truth)
lib/db/queries/            All DB access, server-only
lib/auth/                  better-auth singleton + session helpers
lib/ai/                    OpenRouter provider, summarization
lib/advisor/, lib/memory/  Advisor tools + long-term memory
lib/market/                Provider registry, cache, Yahoo + Thai SEC
lib/portfolio/             Analytics, plan parsing, plan-edit, OCR, health/score
lib/static/                Editorial content + placeholder analytics
lib/mock/                  Seed data (db:seed) + demo seed (never imported by UI)
```

For the full status of what's built vs. planned, the authoritative source is
[ROADMAP.md](../../ROADMAP.md).
