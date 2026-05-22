# Roadmap

> **Status:** Active. The working plan for turning the static-data prototype
> into real software. Last updated 2026-05-22 (Phase 3b detailed, Phase 5
> sketched, thread-list sidebar landed).

## How to read this doc

- **Source of truth for feature status.** Every shipped feature should be
  reflected in [Phases at a glance](#phases-at-a-glance) and its phase
  section. If reality drifts from what's written here, fix the doc.
- **Phases are gates, not silos.** A "shipped" phase has acceptance criteria
  met; a "partial" phase has working pieces but missing AC.
- **The implementation order section in each phase is the contract.** When
  changing it, leave a one-line note explaining why.

See [AGENTS.md](./AGENTS.md) for project conventions an AI agent needs before
touching code (DB routing, demo mode, where things live).

---

## State of the world

**Phase 1 is shipped.** As of 2026-05-22:

- SQLite + Drizzle persistence layer; 15 tables (10 app + 5 auth), daily backups.
- `/api/buckets`, `/api/holdings`, `/api/journal`, `/api/plan`, `/api/models`,
  `/api/quotes`, `/api/settings` all live; PortfolioScreen, JournalScreen,
  ModelPortfoliosScreen, App, AppPanels all read via SWR fetchers.
- Bucket + holding CRUD wired to the UI (BucketSheet, HoldingSheet).
- Add holdings sheet (CSV file upload / paste / manual) writes through to
  `/api/holdings`.

**Phase 2 scaffold shipped** (chat plumbing + multi-user gate + demo mode):

- `/api/chat` with Vercel AI SDK + streamText, owner/demo provider routing.
- Single AI provider abstraction (OpenRouter) — one key, every major model
  (Anthropic / OpenAI / Google / Meta / Mistral / DeepSeek). Owner uses
  `OPENROUTER_API_KEY`; demo uses `DEMO_OPENROUTER_API_KEY` or falls back
  to the same key with the free-tier `openrouter/free` router so demo
  traffic never burns paid credits.
- Demo provider hard-capped at 10 chat turns per session, enforced server-side.
- `ChatScreen` consumes the UI message stream and renders text-deltas live.
- IP rate limit (20 RPM) on `/api/chat`. Security headers (X-CTO, X-Frame,
  HSTS, Referrer-Policy, Permissions-Policy with tight `publickey-credentials`)
  in `next.config.ts`.
- 23 vitest tests including AsyncLocalStorage isolation + provider routing.

**Phase 2.5 shipped** (passkey + demo button — single-owner, not multi-user):

- better-auth + `@better-auth/passkey` with drizzle-adapter against the same
  SQLite. Endpoints at `/api/auth/[...all]`.
- `/login` screen — passkey sign-in, account creation (registers a
  passkey on first sign-up), or "Try the demo".
- Auth is required by default; set `AUTH_DISABLED=1` to opt out (trusted
  local dev only). Demo cookie bypasses the gate.
- **Per-session demo DBs** — each demo gets its own isolated in-memory
  SQLite seeded with mock data. AsyncLocalStorage routes every query to the
  right DB. Idle TTL 1h, hard cap 200 concurrent. Real users still share
  the owner SQLite (single-tenant for now).

**Phase 2.6 mostly shipped** (chat persistence + plan-edit Apply + mock cleanup):

- `lib/db/queries/chat.ts` wired to the previously-dead `chat_threads` +
  `chat_messages` tables. `/api/chat` persists the user message before the
  stream + the assistant message in an `onFinish` callback that re-enters
  the request's `AsyncLocalStorage` DB context (so demo writes land in the
  per-session in-memory SQLite).
- `/api/chat/threads` + `/api/chat/threads/[id]` (GET / POST / PATCH /
  DELETE).
- `ChatScreen` hydrates the most-recently-active thread on mount via
  localStorage. New "New chat" button in the topbar.
- Plan-edit "Apply" no longer mutates the mock module — it fetches
  `/api/plan`, applies the proposal via `lib/portfolio/plan-edit.ts`
  (pure helper, 5 vitest cases), PUTs the result, and invalidates the
  SWR cache so JournalScreen → Plan tab reflects the change.
- Editorial + placeholder constants migrated out of `lib/mock/data.ts`:
  `lib/static/{markets,learn,personalities,analysis}.ts` +
  `lib/portfolio/plan-parser.ts`. Zero component imports from
  `@/lib/mock/data` remain.
- **Deferred:** thread-list sidebar UI. The localStorage-pinned "current
  thread" delivers reload-survives chat without a layout rework.

**Phase 3 partial:** Yahoo Finance client + cache + `/api/market/indices`;
MarketsScreen pulls live SET / S&P / Nasdaq / Nikkei / USD-THB with 24h
cache and graceful 429 fallback. News, digest, learn content, and Thai
mutual-fund NAVs still mocked. Phase 3b adds Thai fund NAVs via the
official Thai SEC Open API (free with a subscription key).

What's still mocked: ANALYSIS scores (need AI tool-calls — Phase 6),
ANALYSIS chart series (need NAV history backfill — Phase 3b), market news
(Phase 3b), benchmark + drift + contrib series on PortfolioScreen.

The 7-screen UI is intact and responsive across mobile / tablet / desktop.

**Tooling already in place** (pre-Phase-1 setup pass, 2026-05-21):

- React 19 + TypeScript 5.9
- Biome for lint + format (replaces ESLint + Prettier)
- simple-git-hooks + lint-staged for pre-commit
- GitHub Actions CI (typecheck / lint / build) + Dependabot (weekly npm + GH Actions)
- `.nvmrc` (Node 24) + `.editorconfig` + `engines: node >=20`

**Known lint debt** (Biome rules disabled in `biome.json` to keep CI green
during early development; revisit during the aesthetic pass after Phase 1):

- `a11y/useButtonType`, `a11y/noStaticElementInteractions`,
  `a11y/useKeyWithClickEvents`, `a11y/noSvgWithoutTitle`,
  `a11y/noLabelWithoutControl` — ~160 violations across the existing UI. A
  proper accessibility pass is a deliberate later task, not a tooling
  decision.
- `suspicious/noArrayIndexKey`, `correctness/useExhaustiveDependencies`,
  `performance/noImgElement`, `style/noDescendingSpecificity` — downgraded to
  warnings; clean up opportunistically.

## Why this build order

Easiest → hardest, lowest risk → highest risk:

1. **Persistence** — mechanical, no third-party unknowns, unlocks everything.
2. **AI chat** — highest user-visible value once persistence is in.
3. **Multi-user mode (optional)** — only needed before deploying to a shared
   instance. Localhost users skip this phase entirely.
4. **Market data** — moderate plumbing; needed to make charts real.
5. **Portfolio import** — hardest because brokerage data sources are unreliable.

Aesthetics deliberately come last (and inline, not as a phase). Real data
exposes the gaps that need polish; polishing on mock data risks rework.

## Phases at a glance

| # | Phase | Status | Notes |
| - | --- | --- | --- |
| 1 | Persistence | ✅ Shipped 2026-05-21 | SQLite + Drizzle |
| 2 | AI chat | 🟡 Partial | Scaffold + streaming + history persistence live; tool calls + plan-edit cards pending Phase 6 |
| 2.5 | Passkey + demo | ✅ Shipped 2026-05-21 | Single-owner auth + per-session in-memory demo DB |
| 2.6 | Cleanup & chat persistence | ✅ Shipped 2026-05-22 | Chat history persists; plan-edit Apply wired; mock-import migration done. Thread-list sidebar deferred to a polish pass |
| 3 | Market data | 🟡 Partial | SET/global indices live; funds + news in 3b |
| 3b | Fund NAVs + news + NAV history | 🟡 Mostly shipped | Provider + v2 endpoints + holdings.quote_source + PortfolioScreen wiring all live; RSS news still pending |
| 4 | Portfolio import | 🟡 Partial | CSV done; Image OCR shipped 2026-05-22 (free-tier OpenRouter vision via `/api/import/image`); manual-entry autocomplete pending |
| 4b | Broker scraping / API integration | Out of scope | Revisit only if a clear personal need emerges |
| 5 | Long-term memory + history compression | Pending | Per-user explicit-save preferences; chat compression to control OpenRouter cost. Research libraries first |
| 5b | Scheduled jobs / digests / notifications | Pending | Depends on 3b and 6 |
| 6 | Multi-user (Google + GitHub SSO + passkey, public-discoverable) | Pending | Data-layer migration to per-user, OAuth, Turnstile, quotas, account page |

## Phase 1 — Persistence

**Goal:** every piece of state the user creates or edits survives a reload, and
the data layer is honest TypeScript (not module-level mutable mock).

### Stack pick

- **SQLite via `better-sqlite3`** (synchronous, embedded, zero-config) +
  **Drizzle ORM** (typed, migration-friendly, lightweight).
- Why not Prisma: heavier, slower codegen, opinionated CLI.
- Why not Supabase / Postgres: this is a personal app, single VM at most.
  SQLite in WAL mode handles ~10K reads + ~1K writes/sec; family-scale
  multi-user is nowhere near that limit. Managed Postgres adds operational
  overhead with no current benefit.
- Migration paths:
  - **SQLite → Turso (libSQL):** drop-in compatible, edge-replicated, free
    tier ample. Drizzle has first-class support. Hours, not days.
  - **SQLite → Postgres:** Drizzle dialect-swap is one config change; the
    migration generator handles most of it.

### Portable Drizzle rules

To keep both migration paths open, write schemas in the portable subset:

- Use Drizzle's `mode: "json"` for JSON columns (not raw TEXT). Reads/writes
  stay typed.
- Use Drizzle's `boolean()` (not raw INTEGER 0/1) — maps correctly per dialect.
- Store dates as ISO-8601 strings; avoid SQLite-only datetime functions.
- Avoid `json_each` / `json_extract` in app code — use Drizzle's typed JSON
  access. Composite indexes via Drizzle's `index()` builder, not raw DDL.
- Single-table booleans / enums as TEXT (`"pending" | "accepted" | "rejected"`),
  not integers — readable in any dialect, validates at the Zod boundary.

### Schema (sketch)

```sql
-- Buckets (replaces lib/mock/data.ts PORTFOLIOS)
CREATE TABLE buckets (
  id TEXT PRIMARY KEY,                -- "main" | "ssf" | "experiment" | custom
  name TEXT NOT NULL,
  type_label TEXT,                    -- "Core" | "Tax-advantaged (SSF)" | ...
  icon TEXT,                          -- emoji or icon key
  brokerage TEXT NOT NULL,            -- e.g. "Demo Broker"
  goal_text TEXT,                     -- markdown one-liner
  target_allocation TEXT,             -- JSON: { equity: 70, bond: 20, ... }
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Holdings (the actual fund positions)
CREATE TABLE holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_id TEXT NOT NULL REFERENCES buckets(id),
  ticker TEXT NOT NULL,
  thai_name TEXT,
  english_name TEXT NOT NULL,
  category TEXT,
  asset_class TEXT,                   -- equity | bond | cash | alternative
  region TEXT,                        -- TH | US | Global | EM
  units REAL NOT NULL,
  avg_cost REAL,
  ter REAL,                           -- expense ratio %
  color TEXT,                         -- oklch() for chart slices
  source TEXT,                        -- e.g. "Demo Broker"
  acquired_on TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Live NAV + perf cache (updated by Phase 3)
CREATE TABLE fund_quotes (
  ticker TEXT PRIMARY KEY,
  nav REAL NOT NULL,
  d1_pct REAL,
  ytd_pct REAL,
  y1_pct REAL,
  updated_at TEXT NOT NULL
);

CREATE TABLE nav_history (
  ticker TEXT NOT NULL,
  date TEXT NOT NULL,                 -- YYYY-MM-DD
  nav REAL NOT NULL,
  PRIMARY KEY (ticker, date)
);

-- User's investment plan (markdown blob; parsed at read time)
CREATE TABLE plans (
  id INTEGER PRIMARY KEY,             -- always 1; single-row table for v1
  markdown TEXT NOT NULL,
  selected_model_id TEXT,             -- foreign key to model_portfolios.id
  updated_at TEXT NOT NULL
);

-- Journal entries (notes, decisions, questions, reading)
CREATE TABLE journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                 -- "note" | "decision" | "question" | "reading"
  title TEXT,
  body TEXT,
  url TEXT,                           -- only for "reading"
  source TEXT,                        -- only for "reading"
  tags TEXT,                          -- JSON array
  pinned INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  archived_at TEXT
);

-- Model portfolios (built-ins + user custom)
CREATE TABLE model_portfolios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  built_in INTEGER DEFAULT 0,         -- 0=user-defined, 1=built-in
  allocation TEXT NOT NULL,           -- JSON: same shape as buckets.target_allocation
  expected_return REAL,
  expected_volatility REAL,
  created_at TEXT NOT NULL
);

-- Chat threads + messages (for Phase 2)
CREATE TABLE chat_threads (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id),
  role TEXT NOT NULL,                 -- "user" | "assistant" | "tool"
  content TEXT NOT NULL,              -- markdown for user/assistant; JSON for tool
  tool_call_id TEXT,                  -- when role=tool
  feedback TEXT,                      -- "up" | "down" | NULL
  created_at TEXT NOT NULL
);

-- Settings (kv store)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL                 -- JSON
);
```

Theme + viewport-state stay in localStorage (don't need durability across
machines).

### File layout

```
lib/
  db/
    client.ts          # Drizzle + better-sqlite3 singleton (Node only; globalThis-pinned in dev)
    schema.ts          # Drizzle table definitions (one file, mirrors SQL above)
    backup.ts          # SQLite online backup via db.backup(); rotates 30 days
    migrations/        # generated by drizzle-kit
    queries/
      buckets.ts
      holdings.ts
      plan.ts
      journal.ts
      models.ts
      chat.ts
      settings.ts
  mock/
    seed.ts            # populates DB from existing mock/data.ts (kept for seeding)
    data.ts            # KEPT temporarily — used to seed, then dropped in Phase 4

app/
  api/
    buckets/route.ts             # GET (list), POST (create)
    buckets/[id]/route.ts        # GET, PATCH, DELETE
    holdings/route.ts            # POST (create), GET ?bucket=…
    holdings/[id]/route.ts       # PATCH, DELETE
    plan/route.ts                # GET, PUT
    journal/route.ts             # GET (with filters), POST
    journal/[id]/route.ts        # PATCH, DELETE
    models/route.ts              # GET, POST
    models/[id]/route.ts         # PATCH, DELETE
    settings/route.ts            # GET, PUT
```

Client side, swap direct `lib/mock/data.ts` imports for fetcher hooks:

```
lib/
  fetchers/
    useBuckets.ts        # SWR or React Query
    useHoldings.ts
    usePlan.ts
    useJournal.ts
    useModels.ts
    useSettings.ts
```

Pick **SWR** over React Query — smaller, simpler, and we don't need RQ's mutation
machinery; we'll wire mutations as plain `fetch` + `mutate()` calls.

### Implementation order

1. `npm install better-sqlite3 drizzle-orm` + `npm install -D drizzle-kit @types/better-sqlite3`.
2. `lib/db/client.ts` + `lib/db/schema.ts` mirroring the schema above.
3. `drizzle-kit generate` → first migration; `lib/db/client.ts` runs migrations on boot.
4. `lib/mock/seed.ts` script that reads the current `lib/mock/data.ts` and inserts
   into the DB. Add `npm run db:seed`. Wipes + reseeds for dev sanity.
5. `lib/db/queries/*.ts` — typed wrappers (`listBuckets()`, `upsertHolding()`,
   etc.).
6. `lib/db/backup.ts` — daily SQLite online backup via `db.backup()`. Called
   from `lib/db/client.ts` at boot when last backup is >24h old; rotates to
   30 days. Backups land in `data/backups/` (gitignored).
7. Pick one screen to migrate first — **start with `PortfolioScreen`** (the
   highest-stakes, most-visited screen).
   - Add the API routes it needs.
   - Add the fetchers.
   - Replace `import { PORTFOLIOS } from "@/lib/mock/data"` with
     `useBuckets()` / `useHoldings(bucketId)`.
   - Add loading + empty states (real DB can be empty; mock data never was).
8. Migrate remaining screens one at a time: Journal, Plan (in JournalScreen),
   Models, then the right-dock panels (BucketsPanel / PlanPanel / NotesPanel).
9. Settings: persist theme + selected model via `/api/settings`.

### Acceptance criteria

- `npm run dev` boots; DB file auto-created at `data/app.db`.
- Reload survives all user-created state: journal entries, plan edits,
  custom model portfolios, theme.
- `data/app.db` and `data/backups/` are in `.gitignore`.
- App boot creates a backup in `data/backups/` if the last one is >24h old;
  backups older than 30 days are pruned.
- Typecheck + build pass.

> **Completed in Phase 2.6 (2026-05-22):** the original criterion
> "`lib/mock/data.ts` no longer imported by any screen" finally shipped.
> Editorial constants moved to `lib/static/*`, parse helpers to
> `lib/portfolio/plan-parser.ts`, `USER_PLAN` mutation replaced with a
> real `PUT /api/plan` round-trip. `grep -rn "from \"@/lib/mock/data\""
> components/` returns zero hits.

### Risk

- **Server-only DB code in client component**: `better-sqlite3` is Node-native;
  any screen that imports a query directly will fail to bundle. Mitigation:
  queries are only called from `app/api/*/route.ts`; client uses fetchers.
- **Schema drift during dev**: Drizzle migrations are forward-only. For a
  personal app, embrace `drizzle-kit drop` + reseed when needed.

---

## Phase 2 — AI chat

**Goal:** the chat panel/screen talks to a real LLM with structured access to
the portfolio, plan, and journal. The model can propose plan edits as
structured cards the user accepts or rejects.

### Stack pick

- **Vercel AI SDK** (`ai` + `@openrouter/ai-sdk-provider`) via **OpenRouter**.
  Reasons:
  - One API key, every major model (Claude, GPT, Gemini, open models).
  - The AI SDK normalizes streaming, tool use, and structured output across
    providers — swap model with a one-string change.
  - Zod-typed tool schemas, shared between server (tool execution) and client
    (proposal card rendering).
- Model: **TBD** — defer until first real call. Sonnet 4.6 and GPT-5 are both
  reasonable defaults; pick based on tool-use quality + cost after a few real
  conversations.
- Env: `OPENROUTER_API_KEY` in `.env.local` (gitignored).
- Prompt caching: enable Anthropic cache headers (passed through by
  OpenRouter) on the system prompt + tool defs to amortize cost on long
  threads.

> **Alternative considered:** Anthropic SDK direct. Simpler tracing, slightly
> better caching ergonomics, but locks the project to one provider. The AI
> SDK's overhead is small enough that flexibility wins for an experimental
> personal app.

### Tools the model gets

| Tool | Args | Returns | Backed by |
| --- | --- | --- | --- |
| `read_portfolio` | `{}` | all buckets + holdings + computed allocation, concentration, weighted TER | `lib/db/queries/{buckets,holdings}.ts` + `lib/portfolio/analytics.ts` |
| `read_plan` | `{}` | plan markdown + parsed sections (target, principles, risk, commitments) | `lib/db/queries/plan.ts` |
| `read_journal` | `{ kind?, tag?, since?, limit? }` | matching entries | `lib/db/queries/journal.ts` |
| `write_journal` | `{ kind, title?, body, tags? }` | `{ id }` | `lib/db/queries/journal.ts` |
| `read_market_view` | `{ tickers?: string[] }` | SET trend + per-ticker NAV deltas (Phase 3 backs this; stub returns mock until then) | `lib/market/*` |
| `propose_plan_edit` | `{ section, before, after, rationale }` | `{ proposal_id }` (renders as a card in chat — user accepts/rejects) | new `proposals` table |

### Plan-edit proposal flow

The single most-valuable interaction loop:

1. User asks: *"Reduce my US tilt to 50%."*
2. Model calls `read_plan` + `read_portfolio`.
3. Model calls `propose_plan_edit` with the exact markdown diff.
4. ChatScreen renders a proposal card (existing UI scaffold in
   `components/screens/ChatScreen.tsx`).
5. User clicks **Accept** → API writes the new plan, archives the old version,
   logs the proposal in chat history.

### File layout

```
app/
  api/
    chat/
      route.ts                  # POST stream endpoint
      tools.ts                  # tool definitions (Zod → Anthropic tool schema)
      execute.ts                # tool dispatcher (matches tool_name → query fn)

lib/
  agent/
    system-prompt.ts            # the advisor persona + index-investing bias
    tool-schema.ts              # Zod schemas, shared between client (proposal cards) and server
    proposals.ts                # propose / accept / reject lifecycle
  portfolio/
    analytics.ts                # allocation, concentration, weighted TER
```

Schema additions for proposals:

```sql
CREATE TABLE plan_proposals (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id),
  section TEXT NOT NULL,        -- "target" | "principles" | "risk" | "commitments" | "raw"
  before TEXT NOT NULL,
  after TEXT NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL,         -- "pending" | "accepted" | "rejected"
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
```

### Implementation order

1. `npm install ai @openrouter/ai-sdk-provider zod`.
2. `lib/agent/system-prompt.ts` — paste a starter prompt; iterate after first
   real call.
3. `lib/agent/tool-schema.ts` — Zod for each tool's args.
4. `app/api/chat/route.ts` — streaming POST; reads thread history from DB,
   calls the AI SDK's `streamText` with the OpenRouter model + tools, handles
   the tool-use loop server-side, persists messages.
5. `app/api/chat/tools.ts` — tool definitions (Zod-typed, fed to AI SDK).
6. `app/api/chat/execute.ts` — switch on tool name, call query fn, return JSON.
7. Wire `ChatScreen` to stream from the endpoint instead of using mock
   `setTimeout` responses. Use the AI SDK's `useChat` (or a thin custom
   `fetch` + `ReadableStream` consumer) client-side.
8. Render tool-call cards (collapsible, like Claude Code's tool-use blocks).
9. Render plan-edit proposal cards. Implement Accept / Reject buttons.
10. `lib/agent/proposals.ts` — accept writes new plan, archives old.

### Acceptance criteria

- ChatScreen + ChatPanel both stream real responses from the selected model.
- Streaming feels responsive (first token <2s on a warm key).
- Model can answer: *"What's my biggest concentration risk?"* — sees real
  portfolio.
- Model can propose a plan edit. User accepts → plan markdown updates and the
  change is visible in JournalScreen → Plan tab on reload.
- Chat history persists across reloads (per thread).
- Costs visible in logs (token in/out per turn).

### Risk

- **Tool-loop runaway**: cap at e.g. 5 tool calls per turn; fail-safe with a
  hard timeout.
- **Streaming + Next.js**: App Router streams via `ReadableStream`. Easy to
  get wrong; copy the AI SDK example verbatim first.
- **Cost**: cap input context (don't dump all chat history; summarize beyond
  N turns).

---

## Phase 2.5 — Passkey + demo (shipped)

> **Status:** ✅ Shipped 2026-05-21. Documents what landed. The unshipped
> multi-user / per-user / magic-link / Resend / allowlist design has moved
> to [Phase 6](#phase-6--multi-user) with a simpler shape.

**What this phase actually delivered:** a single-owner deployment can sit
behind a passkey-gated `/login` screen, and any visitor can spin up an
isolated demo without creating an account.

### What shipped

- **better-auth** + **`@better-auth/passkey`** plugged into the same SQLite
  as app data via the adapter bundled in better-auth core
  (`better-auth/adapters/drizzle`). Catch-all handler at
  `/api/auth/[...all]`.
- **`/login` screen** with three buttons:
  - **Sign in with passkey** — returning user with a passkey registered on
    this device.
  - **Create account** — collects name + email + registers a passkey on
    the device's platform authenticator.
  - **Try the demo** — sets the demo cookie and spins a per-session
    in-memory SQLite seeded with mock data.
- **Secure-by-default gate** — the dashboard refuses to render without a
  session. Opt out with `AUTH_DISABLED=1` in `.env.local` for trusted
  loopback dev only. See [AUTH.md](./AUTH.md), [SECURITY.md](./SECURITY.md).
- **Per-session demo DBs** — each demo session keys an isolated in-memory
  SQLite seeded fresh from `lib/mock/demo-seed.ts`. `AsyncLocalStorage`
  routes every query (owner vs demo) to the correct DB. Idle TTL 1h, hard
  cap 200 concurrent demos. Demo chat capped at 10 turns server-side.
- **Production guard** — `AUTH_SECRET` is required when `NODE_ENV=production`
  (throws on boot if unset). A dev fallback secret keeps `npm run dev`
  frictionless on localhost.

### Env vars added

```
AUTH_SECRET=...        # better-auth signing key; required in production
AUTH_DISABLED=1        # opt-out for trusted local dev only (default: auth required)
PUBLIC_APP_URL=https://... # canonical URL for passkey rpID; passkeys break if this changes
```

### What this phase intentionally did NOT do

- **No multi-user.** App tables (`buckets`, `journal_entries`, `plans`,
  `chat_threads`, `model_portfolios`) have no `user_id` column. Every
  authenticated request operates on the single owner dataset.
- **No magic link.** Skipped to avoid a transactional-email dependency
  (Resend / SMTP / DNS records).
- **No social SSO.**
- **No `/api/auth/*` rate limit.** `AUTH_RATE_LIMIT` is defined in
  `lib/api/rate-limit.ts` but not wired; documented as a Phase 6 task in
  [SECURITY.md](./SECURITY.md). Front with Caddy/Cloudflare for now.

These all move to [Phase 6](#phase-6--multi-user).

### Files of record

- [lib/auth/index.ts](./lib/auth/index.ts) — better-auth singleton, passkey plugin.
- [lib/auth/session.ts](./lib/auth/session.ts) — session reader helper for API routes.
- [lib/db/context.ts](./lib/db/context.ts) — AsyncLocalStorage routing owner vs demo DB.
- [lib/db/demo.ts](./lib/db/demo.ts) — per-session in-memory SQLite with idle sweep.
- [app/(auth)/login/](./app/\(auth\)/login/) — sign-in / create-account / demo UI.

---

## Phase 2.6 — Cleanup & chat persistence

> **Status:** ✅ Shipped 2026-05-22, minus the deferred sidebar (see below).
> Three commits: `a224687` (chat persistence), `6ea577d` (plan-edit Apply),
> `19fe351` (mock-import migration).

**Goal:** make the existing UI honest end-to-end. Chat history survives a
reload, plan-edit "Apply" actually writes through, and no screen reaches
into `lib/mock/data.ts` for live state. This was the cheapest path to
"chat actually feels real" without expanding scope.

### Why this came before Phase 6

Multi-user is a one-way door for the schema (`user_id` everywhere, backfill
existing data). Better to lock the single-owner feature set first, then
migrate once. A friend trying the app via the demo path today would have
gotten a broken-looking experience: streaming chat without persisted history,
plan-edit Apply that quietly did nothing, mock content bleeding through.
Fixing that pays off whether or not Phase 6 ever happens.

### Three deliverables

1. **Persist chat history** — wire the existing `chat_threads` /
   `chat_messages` tables (currently dead schema). Owner and demo paths
   share the code; demo writes land in the per-session in-memory SQLite
   and disappear on idle-sweep.
2. **Wire plan-edit Apply** — replace the `setTimeout(700)` direct
   mutation of `USER_PLAN` in
   [components/screens/ChatScreen.tsx](./components/screens/ChatScreen.tsx)
   with a real `PUT /api/plan`. SWR `mutate()` for instant UI; rollback
   on error.
3. **Migrate mock imports** — five components still reach into
   `lib/mock/data.ts`:

   | Constant | Used by | New home |
   | --- | --- | --- |
   | `ANALYSIS` | PortfolioScreen, AppPanels | `/api/analysis` returning a placeholder `{ score: null }` until AI tool calls land in Phase 6; screens render "—" |
   | `MARKETS`, `LEARN_CONTENT` | MarketsScreen | `lib/static/markets.ts`, `lib/static/learn.ts` — editorial content, code-resident, not DB |
   | `AI_PERSONALITIES` | ChatScreen | `lib/static/personalities.ts` |
   | `MODEL_PORTFOLIOS`, `USER_GOALS`, `USER_PLAN` | ChatScreen | switch to existing `/api/models` + `/api/plan` (`USER_PLAN` ships from plan now; `USER_GOALS` reads from the plan's parsed goals section) |

### File additions

```
lib/
  db/
    queries/
      chat.ts            # createThread, listThreads, listMessages, appendMessage
  static/
    markets.ts           # MARKETS editorial content (was in mock/data.ts)
    learn.ts             # LEARN_CONTENT
    personalities.ts     # AI_PERSONALITIES
app/
  api/
    chat/
      threads/route.ts   # GET (list user's threads), POST (create)
      threads/[id]/route.ts # GET (messages), DELETE
    analysis/route.ts    # placeholder; returns nulls until Phase 6
```

### Implementation order

1. `lib/db/queries/chat.ts` — typed wrappers. The DB tables already exist
   from Phase 1 (`chat_threads` + `chat_messages` in `lib/db/schema.ts`).
2. `/api/chat/route.ts` — after the streamed response finalizes, write
   user message + assistant message in one transaction. Use AI SDK's
   `onFinish` callback. Persist tool calls as `role=tool` rows.
3. `/api/chat/threads/route.ts` + `/api/chat/threads/[id]/route.ts`.
4. ChatScreen: thread list in the sidebar (load via SWR), thread switcher,
   "new thread" button, delete thread.
5. Wire plan-edit Apply → `PUT /api/plan` with the proposed markdown.
6. Extract editorial constants to `lib/static/*`; update screen imports.
7. Replace `ANALYSIS` reads with `/api/analysis` fetcher returning nulls;
   render "—" placeholders. Real numbers land in Phase 6 via AI tool
   calls (`read_portfolio` + the model computing concentration, drift,
   weighted TER).
8. `MODEL_PORTFOLIOS` + `USER_GOALS` + `USER_PLAN` switch to existing
   `/api/models` and `/api/plan` fetchers.

### Acceptance criteria

- New chat thread persists user + assistant + tool messages; reload shows
  the same conversation.
- Two threads in the sidebar can be switched without state leak.
- Plan-edit proposal `Apply` writes through `/api/plan`; reload of
  JournalScreen → Plan tab shows the change.
- `grep -rn "from \"@/lib/mock/data\"" components/` returns zero hits
  outside of `lib/mock/seed.ts` and `lib/mock/demo-seed.ts`.
- Demo session: chat history persists for the session lifetime, swept on
  idle-TTL like the rest of demo state.
- Typecheck + lint + build + tests all green.

### Deferred (sidebar UI) — shipped 2026-05-22

Originally scoped out of the initial 2.6 commits. Landed alongside the
Phase 3b polish pass: [components/ChatThreadList.tsx](./components/ChatThreadList.tsx)
provides a slide-out drawer triggered from a hamburger button in the
chat topbar.

- Threads grouped by recency buckets (Today / Yesterday / Last 7 days
  / Last 30 days / Older), most-recent first.
- Click a thread to switch (its messages hydrate via the existing
  `/api/chat/threads/[id]` endpoint).
- Per-thread delete with a confirm prompt.
- Closes on Escape or backdrop click. Mobile-friendly width
  (`min(320px, 88vw)`).

### Outstanding (deferred to Phase 6)

- **No `/api/analysis` route.** `ANALYSIS` placeholder lives in
  `lib/static/analysis.ts` and is read directly by PortfolioScreen +
  AppPanels. Wiring an API route is wasted work until the numbers come
  from AI tool calls — when they do, the route shape lands at the same
  time. Until then the static-import path is the minimum thing.
- **Types still in `lib/mock/types.ts`.** Components import shared types
  (`Holding`, `Portfolio`, `LearnArticle`, etc.) from `@/lib/mock/types`.
  These aren't mock — just misnamed. A future rename moves them to
  `lib/static/types.ts` or `lib/types.ts`. Cosmetic, not blocking.

### Risk (retained for posterity)

- **Streaming + persistence timing** — writing only after `onFinish`
  means a mid-stream client disconnect drops the assistant message.
  Acceptable for v1; revisit if it bites.
- **Plan-edit format** — for now, "Apply" sends the full proposed
  markdown. Structured diffs (`section`, `before`, `after`) wait until
  Phase 6's AI tool-call surface is real.

---

## Phase 3 — Market data (partial, shipped)

**Goal:** the charts on PortfolioScreen and MarketsScreen show real prices.
The `read_market_view` tool gives the model live data.

### What shipped

- `lib/market/yahoo.ts` — Yahoo Finance chart client (no auth, needs UA).
- `lib/market/cache.ts` — SQLite-backed cache against `fund_quotes` +
  `nav_history` (5-min quote TTL, 24h history TTL).
- `lib/market/indices.ts` — convenience wrapper for SET / S&P / Nasdaq /
  Nikkei / USD-THB.
- `app/api/market/indices/route.ts` powers `MarketsScreen`.

### Sources

| Data | Provider | Notes |
| --- | --- | --- |
| SET index + global indices + FX | Yahoo Finance `query1.finance.yahoo.com` | No auth. UA header required. 24h history cache, 5min quote cache. |
| Thai mutual fund NAVs | **Thai SEC Open API** (Phase 3b) | Official government source. Free with subscription key. |
| News (Thai + global) | RSS aggregation (Phase 3b, optional) | Bangkok Post, SET news, etc. XML parsing. |

### Risk (retained)

- **Yahoo blocks**: rare but happens. Have a retry + UA rotation. If it
  becomes painful, swap to Alpha Vantage (free tier 25 calls/day; enough for
  a daily refresh).

---

## Phase 3b — Thai fund NAVs + NAV history

**Goal:** real Thai mutual-fund NAVs land in `fund_quotes` + `nav_history`
so PortfolioScreen shows accurate value-vs-cost on real holdings, and the
chat advisor can reference real returns.

### Source — Thai SEC Open API

The **Securities and Exchange Commission of Thailand** publishes daily
fund disclosure data via an official, government-run API. This is the
authoritative source — better than scraping any private fund supermarket.

- **Portal:** [secopendata.sec.or.th/sec-open-apis](https://secopendata.sec.or.th/sec-open-apis)
  (launched 2026-01-12; legacy [api-portal.sec.or.th](https://api-portal.sec.or.th/)
  retires 2026-06-30 — we're already on the new portal's v2 paths).
- **Pricing:** free for public disclosure data. One subscription gives
  Primary + Secondary keys (rotation pair) covering all 6 product groups
  (`/bond`, `/fund`, `/digital-asset`, `/LicenseCheck`, `/onereport`,
  `/pvd`). Header: `Ocp-Apim-Subscription-Key`.
- **Rate limit:** 5,000 calls per 300 seconds. Min ≥16 ms between requests.
  HTTP **421** (not 429) signals over-limit; respect `Retry-After`.
- **Refresh windows:** 09:30 + 17:30 Bangkok time.
- **Endpoints used (v2):**
  - `GET /v2/fund/general-info/amcs` — list of asset management companies.
  - `GET /v2/fund/general-info/profiles?company_info={unique_id}` — funds
    for one AMC (resolves abbr → proj_id).
  - `GET /v2/fund/daily-info/nav?proj_id={id}&start_nav_date=…&end_nav_date=…`
    — daily NAV time series. Single call returns the whole range,
    paginated via cursor. Major win vs the legacy per-date model.
- **Response envelope (all v2):** `{ message, page_size, next_cursor, items: [...] }`.
  Empty `next_cursor` = last page. Default/max `page_size` = 100.

> No private-company data sources are referenced in code or docs. Reason:
> avoid TOS/legal exposure and brand-implication for an experimental
> personal project. If the SEC API gaps need filling, raise as a discussion
> with the user — don't quietly add a scraper.

### Provider plug-in shape (refactor first)

Current `lib/market/yahoo.ts` is the only provider and `lib/market/cache.ts`
hard-codes Yahoo. Refactor to a registry so adding providers is a one-file
change:

```
lib/market/
├── providers/
│   ├── types.ts        # Provider interface; normalized Quote / Series
│   ├── yahoo.ts        # US, global, Thai SET index, FX
│   └── sec-thailand.ts # Thai mutual fund NAVs (Phase 3b)
├── registry.ts         # resolve(symbol) -> Provider
├── cache.ts            # provider-agnostic
└── indices.ts          # uses cache
```

**Source routing** (via `holdings.quote_source` column):

| `quote_source` | Provider | Ticker examples |
| --- | --- | --- |
| `"yahoo"` | yahoo | `^SET.BK`, `THB=X`, `AAPL`, `PTT.BK` |
| `"thai_mutual_fund"` | sec-thailand | `K-FIXED-A`, `HIDIV-D` |

The source value names the asset class, not the provider — holdings stay
valid if the registry's routing map is later changed. New providers should
claim asset-class names (`crypto`, `bond`, `fx`), not provider names. See
`lib/market/sources.ts` for the constants and UI labels.

User-visible tickers are bare (no `thfund:` prefix or other namespace).
Internal cache keys in `fund_quotes.ticker` + `nav_history.ticker` use the
combined `${source}:${ticker}` so one table can hold quotes for different
sources. `Quote` and `Series` types are provider-agnostic
(`{ price, asOf, currency }` and `[{ date, close }]`).

### Status

- ✅ **Refactor `lib/market/` to provider shape** — shipped.
- ✅ **`lib/market/providers/sec-thailand.ts`** — v2 endpoints, cursor
  pagination, 421 handling, on-demand share-class lookup. 11 vitest
  cases (100% synthetic data).
- ✅ **`holdings.quote_source` schema column** + `lib/market/sources.ts`
  taxonomy. Decouples routing from the symbol, scales cleanly to new
  asset classes (crypto, bonds, FX, …) without re-tagging holdings.
- ✅ **`app/api/quotes/route.ts`** — `?refresh=1&refs=source:ticker,…`
  dispatches through the registry and populates `fund_quotes` /
  `nav_history`.
- ✅ **`useRefreshedQuotes()` fetcher hook** (paired
  `{source, ticker}` refs).
- ✅ **`HoldingSheet` type selector** — user picks "Thai mutual fund"
  or "Stock / ETF / Index" per holding; sets `quote_source` on save.
- ✅ **`usePortfolioView` overlays live quotes** onto the cached map
  so PortfolioScreen shows real value-vs-cost as soon as the refresh
  returns (cached/avg-cost fallback renders first).
- ✅ **`npm run smoke:sec -- <FUND-CODE>`** for live verification.
- ⏳ **News (RSS) — optional** — `lib/market/news.ts` aggregates Bangkok
  Post and SET news RSS. May ship as Phase 3c instead.

### Env vars added

```bash
SEC_API_KEY=...   # Thai SEC Open API subscription key (Ocp-Apim-Subscription-Key)
```

### Acceptance criteria

- `npm run typecheck` + `npm test` + `npm run build` all green after the
  provider refactor with no behavior change.
- Fresh `SEC_API_KEY` resolves a Thai fund symbol end-to-end:
  `curl 'http://localhost:3000/api/quotes?refresh=1&refs=thai_mutual_fund:<code>'` returns
  `{ symbol, price, asOf, currency }` with a real NAV.
- Subsequent requests within TTL hit cache (no outbound network call).
- PortfolioScreen renders real NAVs for Thai-fund holdings and "—" for
  unknown ones, without crashing.
- Daily series populates `nav_history` and powers the perf chart for at
  least 30 days of data.
- `Ocp-Apim-Subscription-Key` is never logged at info level; never
  returned in browser-visible payloads.

### Risk

- **Holiday gaps**: SET observes Thai public holidays; NAV history has
  natural gaps. Charts must render gracefully.
- **Subscription key lifecycle**: keys can be rotated. Surface a clear
  401-handling error path; document key-rotation steps in
  [DEPLOY.md](./DEPLOY.md).
- **Cost discipline**: rate limit is generous but cache-first remains the
  default. Never bypass the cache from a hot path.

### Out of scope (Phase 3b)

- Real-time intraday prices for SET stocks (Phase 3 covers index-level).
- Earnings calendars, macro data feeds.
- Broker scraping (Phase 4b, possibly never).
- Commercial fund-supermarket data sources — see "Source" note above.

### Known follow-ups (Phase 3b polish pass)

- **PerfChart interactivity** — the current chart in [components/charts.tsx](./components/charts.tsx)
  is hand-drawn SVG with `preserveAspectRatio="none"`. This stretches the
  entire `<svg>` (including axis-label `<text>` glyphs) to the container
  width, so labels look visually wide on a desktop layout. It also has no
  hover/tap tooltip — you can't read the value at a date.

  Options when we revisit:
  1. **Render axis labels in HTML overlaying the SVG** (cheap fix for the
     stretching only — still no tooltips).
  2. **Adopt a chart library** — leading candidates:
     - **uPlot** (~40KB, fastest, imperative) — good for many series, but
       its visual idiom is BI-dashboard rather than our typography-led look.
     - **visx** (~50KB tree-shaken) — keeps SVG primitives but supplies
       scales/axes/tooltip helpers. Closest match to the current aesthetic.
     - **lightweight-charts** (TradingView, ~100KB) — finance-flavored,
       built-in crosshair/tooltip; opinionated styling.
     - **Recharts** (~100KB+) — easiest API but heavier and most opinionated
       visually.

     Lean: **visx** when the time comes — it gives us tooltip + axis-tick
     spacing without forcing a different visual style.

  Trigger to actually do this: when we add hover-to-inspect or
  brush-to-zoom. Until then, the stretched labels are tolerable.

---

## Phase 4 — Portfolio import

**Goal:** the holdings shown in the app are **your real holdings**, not
seeded mock data.

### Three input paths (UI already scaffolded in `AddHoldingsSheet`)

1. **CSV upload** — easiest. User exports from broker / types into a file
   matching a small fixed schema (`ticker,name,units,avg_cost,acquired_on,account`).
2. **Image OCR** — user pastes a screenshot of their broker app; Claude vision
   reads it and proposes rows for confirmation.
3. **Manual entry** — ticker autocomplete (from fund-platform DB) + units +
   avg cost.

Defer **broker scraping / API integration** — that's Phase 4b, only worth it
once you have a clear personal need.

### Implementation order

1. **CSV first** (the smallest useful loop).
   - `lib/portfolio/import.ts`: Zod schema, CSV parse via `csv-parse/sync`,
     upsert into `holdings` + `buckets`.
   - `app/api/import/csv/route.ts`: accepts `multipart/form-data`.
   - Wire the CSV tab of `AddHoldingsSheet`.
   - Sample file at `data/sample-holdings.csv`.
2. **Image OCR** (shipped 2026-05-22).
   - `lib/portfolio/ocr.ts`: send image to an OpenRouter vision model via
     Vercel AI SDK `generateObject` with a strict Zod schema → return
     `{ rows: ProposedRow[] }`. Defaults to a `:free` model (currently
     `google/gemma-4-31b-it:free`) so this path never burns paid credits.
     Override with `OCR_MODEL` env var.
   - `app/api/import/image/route.ts`: multipart/form-data POST, 5 MB cap,
     JPG/PNG/WebP only, 10 RPM IP rate-limit, returns 503 cleanly when
     `OPENROUTER_API_KEY` is unset.
   - Image tab of `AddHoldingsSheet`: editable confirmation table
     (ticker / name / units / avgCost / quoteSource) with add-row + remove-row
     before save. Inline per-row error states; quoteSource auto-inferred from
     ticker shape (hyphenated → `thai_mutual_fund`, otherwise `yahoo`).
3. **Manual entry**.
   - Build an autocomplete on `holdings` history + a small seed of common
     tickers (kept in `lib/data/known-funds.ts`, not the DB).
   - Wire the Manual tab.
4. **Drop `lib/mock/data.ts`** — replace `npm run seed` with a minimal "demo"
   seed that creates one empty bucket so the UI isn't blank on first run.

### Acceptance criteria

- Fresh DB (`rm data/app.db && npm run dev`) → app boots with an empty state UI,
  not a crash.
- CSV import: round-trip your actual portfolio in <60s.
- Image OCR: 80%+ row accuracy on a clean broker screenshot (ticker + units +
  avg cost). Misreads are editable in the confirmation table.
- Manual entry feels frictionless: ticker autocomplete <100ms, units + cost
  validated.

### Risk

- **OCR hallucinations**: model invents ticker names. Mitigation: strict
  schema, low temperature, validation against `known-funds.ts`.
- **CSV variance**: real broker exports have weird columns. Build the parser
  defensively; let the user map columns in the UI if auto-detect fails.

---

## Phase 5 — Long-term memory + history compression

**Goal:** the chat advisor remembers what the user has told it across
threads (preferences, risk tolerance, constraints) AND long threads stay
affordable on OpenRouter. Two related concerns, one phase, because both
center on "what we send to the model on every turn."

> **Status:** Pending. Specifies the design and the libraries to research
> before any code lands. Do not start implementation without re-validating
> the recommendations below — the AI agent memory space is moving fast.

### 5a — Long-term per-user memory (explicit save)

**Approach:** Option A from the planning discussion — the model has an
explicit tool the user (implicitly or explicitly) triggers. No silent
auto-summarization of the conversation behind the user's back.

```ts
// model tool definition (sketch — Vercel AI SDK shape)
save_preference: {
  description: "Save a durable fact about the user (preference, constraint, goal).",
  parameters: z.object({
    key: z.string(),           // e.g. "max-single-stock-pct"
    value: z.string(),         // e.g. "15"
    rationale: z.string(),     // why we're saving this; goes in the audit row
  }),
}
forget_preference: { parameters: z.object({ key: z.string() }) }
list_preferences: { parameters: z.object({}) }
```

Triggered by phrases like *"remember that I never want >15% in any single
stock"* or *"forget what I said about retirement age"*. Stored in a new
`user_preferences` table, surfaced as a system-message section on every
chat turn, editable in the Settings page.

**Schema sketch:**

```sql
CREATE TABLE user_preferences (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT,                     -- NULL pre-Phase-6; FK after
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  rationale  TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, key)
);
```

### 5b — Chat history compression

**Approach:** hierarchical summarization paired with a sliding window.
When a thread exceeds N tokens (or M turns), summarize the older half
into a single system-message block, drop the originals from the model
input. Original messages stay in `chat_messages` for display; only the
**model input** is compressed.

Trigger options (TBD during implementation):

- Turn-count threshold (e.g. >30 turns)
- Token-count threshold (e.g. >40% of model context)
- Cost threshold (input tokens × current price > $X)

### Research before coding

The agent-memory space has matured fast. Before starting 5a/5b, evaluate
these libraries against macrotide's constraints (single-VM, SQLite,
TypeScript, no Python sidecar):

| Library | Strength | Fit for macrotide |
| --- | --- | --- |
| **mem0** | Open-source memory layer that bolts onto existing chat. JS SDK. Vector + relational hybrid. | Strong candidate for 5a. Validate the JS SDK shape against the AI SDK tool-call pattern. |
| **Letta (MemGPT)** | OS-inspired tiered memory (core / archival / recall). Self-editing memory via tool calls. | Heavier than we need; designed for autonomous long-running agents, not chat advisors. Skip unless 5a's explicit-save model proves insufficient. |
| **Zep** | Production-grade vector + graph; strong for long-running enterprise sessions. | Mostly Python; service-oriented. Wrong scale for a personal app. |
| **LangChain Memory** | Built-in summarization buffers, vector retrievers. | Adds a heavy dependency for one feature. Prefer a 50-line bespoke implementation over pulling in LangChain. |
| **Cognee** | Deep knowledge graph retrieval. | Overkill. |
| **Hand-rolled** | Direct Drizzle + AI SDK. Full control. | The honest default. Memory in macrotide is small (preferences + plan + journal already exist as structured tables). |

**Recommendation entering implementation:** start hand-rolled for 5a
(it's <200 lines), and only adopt mem0 if the bespoke version starts
duplicating significant infrastructure. For 5b, prototype summarization
with a cheap model (Haiku 4.5) using the same OpenRouter key, no library
required.

**Recommendation update for compression:** the summarize-and-replace
pattern Claude Code itself uses (the `<summary>` block at the start of
this conversation) is the proven baseline. Implement that first, then
measure whether semantic retrieval over `chat_messages` adds enough
value to justify a vector store.

### File layout (sketch)

```text
lib/
  memory/
    preferences.ts          # CRUD over user_preferences
    inject.ts               # build the system-message memory block per turn
    compression.ts          # turn ChatMessage[] -> (summary, recentWindow)
  db/
    queries/
      preferences.ts        # typed wrappers
```

### Implementation order

1. **Re-validate library choices** — read the latest docs for mem0,
   Letta, LangChain Memory; check JS SDK shapes; benchmark prompt
   sizes; decide.
2. **5a schema + queries** — `user_preferences` table, Drizzle migration.
3. **5a tool definitions** — `save_preference` / `forget_preference` /
   `list_preferences` in the chat tools surface. Persist tool-call rows
   in `chat_messages`.
4. **5a system-message injection** — every chat turn loads preferences,
   formats as a small markdown block, prepends to the system prompt.
5. **5a Settings UI** — list / edit / delete preferences. Cards with
   rationale visible.
6. **5b token measurement** — log per-turn input/output tokens in the
   existing `usage` table (defined in Phase 6 schema, materialize early
   if needed).
7. **5b summarizer** — when thread exceeds threshold, call cheap model
   to produce a summary; store as a `chat_messages` row with
   `role='system'` and a marker; drop summarized rows from the next
   turn's input.
8. **5b sanity** — make sure compression is idempotent and a re-summary
   doesn't drift the meaning.

### Acceptance criteria

- User says *"remember I'm targeting retirement at 50"* → model calls
  `save_preference` → next chat turn (even in a new thread) the model
  shows it knows.
- Settings page lists preferences with delete buttons; deleting them
  removes them from future chat context within one turn.
- A 50-turn thread runs at <2× the input-token cost of a 5-turn thread
  (compression working).
- Compression never drops messages from the persisted DB — only from
  the model's input view.
- Demo path: preferences persist for the session and disappear on
  idle-sweep.

### Risk

- **Library churn**: mem0/Letta/Zep all moved versions in the last 6
  months. Recheck before committing to a dep.
- **Preference rot**: stale "remember I'm 28" becomes wrong over time.
  Surface an `updated_at` and let the user audit. Don't auto-prune.
- **Summarization drift**: hierarchical summaries lose nuance. Mitigation:
  cap depth (one summary per thread, re-generated rather than
  re-summarized).
- **Privacy**: preferences are sensitive. Once Phase 6 ships, never
  surface another user's preferences via tool calls — `user_id` filter
  is invariant.

---

## Phase 5b — Scheduled jobs / digests / notifications

> Renamed from the previous "Phase 5" to make room for the memory phase.
> Unchanged in intent: scheduled NAV refresh, optional weekly digest
> email, push notifications. Depends on 3b and 6.

---

## Phase 6 — Multi-user

**Goal:** open the app to family and friends via a public-discoverable URL
(linked from a personal site / subdomain already behind Cloudflare). Each
account is isolated; the owner's OpenRouter budget is protected by per-user
token caps and free-tier-only access for new accounts. No transactional
email infrastructure required.

### Stack pick

- **Auth library:** stay on **better-auth** — already wired in Phase 2.5.
  No Auth0 / Clerk; the project is single-VM personal scale and the
  vendor cost + lock-in solve problems we don't have.
- **Sign-in methods:**
  - **Google OAuth** + **GitHub OAuth** (better-auth `socialProviders`
    config — built-in, no extra plugin).
  - **Passkey** (existing) — promoted to "second device convenience" once
    you've signed in via OAuth once.
  - **No magic link, no email/password.** Skipping email transport
    eliminates Resend / SPF / DKIM / DMARC / spam-folder pain on the
    critical onboarding path. Add Apple OAuth or magic link later if a
    real user needs it.
- **Bot protection:** **Cloudflare Turnstile** on the sign-up + OAuth
  callback. Free, already in the Cloudflare zone.
- **Admin:** **SQL first.** `sqlite3 data/app.db` + a small set of
  canned queries (list users, see usage, promote tier, ban). Build a
  minimal `/admin` page only if SQL friction shows up; better-auth's
  `admin` plugin exposes the API methods when that day comes.

### Schema changes

```sql
-- All app tables get a user_id. Built-in model_portfolios stay NULL
-- and are visible to everyone.
ALTER TABLE buckets             ADD COLUMN user_id TEXT REFERENCES user(id);
ALTER TABLE journal_entries     ADD COLUMN user_id TEXT REFERENCES user(id);
ALTER TABLE plans               ADD COLUMN user_id TEXT REFERENCES user(id);
ALTER TABLE chat_threads        ADD COLUMN user_id TEXT REFERENCES user(id);
ALTER TABLE model_portfolios    ADD COLUMN user_id TEXT REFERENCES user(id); -- user_id IS NULL for built-ins
-- holdings inherits via bucket_id; no column needed.

-- Per-user daily token cap.
CREATE TABLE usage (
  user_id      TEXT NOT NULL REFERENCES user(id),
  date         TEXT NOT NULL,                 -- YYYY-MM-DD UTC
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- Tier gating: which OpenRouter models a user can hit.
-- "free"     = openrouter/free router only (zero cost to owner)
-- "trusted"  = full owner model chain (AI_MODELS env)
-- Owner promotes via SQL: UPDATE account_tier SET tier='trusted' WHERE user_id=?
CREATE TABLE account_tier (
  user_id    TEXT PRIMARY KEY REFERENCES user(id),
  tier       TEXT NOT NULL DEFAULT 'free',
  granted_at TEXT NOT NULL
);
```

**Backfill:** existing rows in `data/app.db` are assigned to a seed
"owner" account derived from `OWNER_EMAIL` env var. Migration script
inserts a `user` row first, then updates app tables. Document this
loudly so a fresh clone doesn't lose data.

### Env vars added

```bash
OWNER_EMAIL=...                     # account that inherits all pre-Phase-6 data
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
TURNSTILE_SITE_KEY=...              # public, shipped to the browser
TURNSTILE_SECRET_KEY=...            # server verifies token here
DAILY_TOKEN_BUDGET_FREE=20000       # input+output tokens/day/user for "free" tier
DAILY_TOKEN_BUDGET_TRUSTED=200000   # input+output tokens/day/user for "trusted" tier
TOS_URL=/legal/terms                # static page slug
PRIVACY_URL=/legal/privacy
```

### Sub-phases

- **6a — Data layer.** Schema migration, backfill to owner, every query
  in `lib/db/queries/*.ts` takes `userId` and filters
  `WHERE user_id = ? OR user_id IS NULL`. `AsyncLocalStorage` context
  extended to carry `userId`. `requireUser(req)` helper at the top of
  every API route. No user-visible change yet.
- **6b — Identity providers.** better-auth config: `socialProviders:
  { google, github }`, `account.accountLinking.enabled: true`. OAuth
  apps registered in Google Cloud Console + GitHub Developer Settings.
  `/login` UI: Google button, GitHub button, "use a passkey" for
  returning users. Account-page passkey registration prompt on first
  OAuth sign-in.
- **6c — Sign-up gate + abuse defenses.** Turnstile widget on `/login`,
  with server-side token verify on the OAuth callback. Wire
  `AUTH_RATE_LIMIT` on `/api/auth/*` (already defined, just plug it in).
  New accounts default to `tier='free'`. First-time user flow seeds one
  empty bucket so the dashboard isn't blank. Static `/legal/terms` and
  `/legal/privacy` pages; sign-up requires checkbox acceptance.
- **6d — Per-user quotas + tier gating.** `/api/chat` reads
  `account_tier`, picks model chain accordingly (free chain for free
  tier, owner chain for trusted), checks daily cap before forwarding to
  OpenRouter, logs usage after stream finishes. Clear "you've hit
  today's limit" UI.
- **6e — Account UX.** `/account` page: name, email (read-only),
  registered passkeys (with revoke), linked OAuth providers, today's
  token usage, sign out everywhere. Multi-device passkey: prompt to
  register on each new device.

### Acceptance criteria

- A family member with a Google account opens `https://macrotide.<your
  domain>`, clicks **Sign in with Google**, lands authenticated, sees
  an empty dashboard with one seeded bucket. Their data is isolated
  from yours.
- A second account signing in with GitHub sees independent state.
- Without Turnstile, the sign-up flow refuses with a clear error.
- Without a session, `/api/buckets` (and every other app route) returns
  401. With a session, returns only that user's rows.
- A new user is on `tier='free'`: chat resolves to `openrouter/free`
  models regardless of `AI_MODELS`. SQL update to `tier='trusted'`
  promotes them; their next chat uses the owner's model chain.
- Hitting the daily cap returns a clear UI message; usage resets at
  UTC midnight.
- Owner can pull a usage report via SQL: per-user tokens in / out / day.
- Existing demo path still works (anonymous → `/login` → "Try the
  demo" → isolated per-session DB, untouched by 6).
- `OPENROUTER_API_KEY` never appears in browser-visible payloads
  (verify via DevTools).

### What stays out of scope

- **SAML / enterprise OIDC.** Not needed for family/friends. Trivial to
  add later via `@better-auth/sso` if one B2B user materializes.
- **Org / team accounts.** No shared portfolios; the model is one
  human, one account.
- **Billing / paywall.** Tier promotion is manual via SQL. If usage
  outgrows that, build a self-serve upgrade flow then.
- **Magic-link email.** Skipped on purpose. Re-evaluate only if a real
  user shows up without Google or GitHub.
- **Apple OAuth.** Add when needed.

### Risk

- **Backfill surprise.** Migration assigns all existing data to
  `OWNER_EMAIL`. If `OWNER_EMAIL` is wrong on first run after the
  migration, the data is attached to the wrong account. Document
  loudly; provide a re-attach SQL snippet.
- **Per-tier model gating** is the most testable invariant: write
  vitest cases that the free tier can never resolve to a non-free model
  regardless of `AI_MODELS` env. Without this, a config slip burns the
  budget.
- **Turnstile bypass.** Cloudflare-fronted requests trust the
  CF-Connecting-IP header; without that path, IP-based rate limits can
  be spoofed. Verify the trusted-proxy config.
- **OAuth redirect URI drift.** Once `PUBLIC_APP_URL` is locked, never
  change it casually — passkey `rpID` and OAuth callback URIs both
  break. Pin it in production and document loudly.

---

## Deployment

Two supported modes; both are first-class.

### Mode A — localhost (single user)

```bash
npm install
npm run dev      # or `npm run build && npm run start` for production
```

That's it. `data/app.db` lives in the repo's `data/`, backups in
`data/backups/`. No auth, no env beyond `OPENROUTER_API_KEY`. Reach the app
at `http://localhost:3000`.

### Mode B — single-owner self-host (single VM, passkey-gated)

Targets a single Linux VM (any cloud VPS or home server). The owner signs
in with a passkey; visitors can spin up the demo without creating an
account. **Available today** — Phase 2.5 shipped. For inviting family/friends
to sign up with their own accounts, see Phase 6.

**Stack on the VM:**

- **Node 24** (use `nvm` or the distro's nodesource repo).
- **Caddy** as reverse proxy — automatic HTTPS via Let's Encrypt, ~5-line
  Caddyfile. No certbot, no Nginx config tedium.
- **systemd** to keep the Node process alive across reboots. PM2 is fine too
  if you prefer a friendlier UX.
- **SQLite file** at `/opt/macrotide/data/app.db`. Daily backups via the
  existing `lib/db/backup.ts`; mirror to an off-VM object store (e.g.
  Cloudflare R2 — 10 GB free, no egress) via `rclone` cron.

**Caddyfile (the whole thing):**

```caddyfile
macrotide.example.com {
    reverse_proxy localhost:3000
}
```

**systemd unit (sketch, `/etc/systemd/system/macrotide.service`):**

```ini
[Unit]
Description=Macrotide
After=network.target

[Service]
WorkingDirectory=/opt/macrotide
EnvironmentFile=/opt/macrotide/.env
ExecStart=/usr/bin/node node_modules/.bin/next start -p 3000
Restart=always
User=macrotide

[Install]
WantedBy=multi-user.target
```

**First-deploy checklist:**

1. Provision VM (any flavor — 1 vCPU / 1 GB RAM is enough for small scale).
2. Open inbound 80 + 443 in the cloud provider's firewall **and** in the
   VM's local firewall (`ufw` or `firewalld`). The local firewall is the
   common gotcha — providers like Oracle Cloud ship Ubuntu images with
   iptables rules already in place.
3. Point your DNS A record at the VM.
4. Install Node, Caddy, clone the repo, `npm ci`, `npm run build`.
5. Create `/opt/macrotide/.env.local` (chmod 600) with `AUTH_SECRET`,
   `PUBLIC_APP_URL`, `OPENROUTER_API_KEY`, `AI_MODELS`. Add Phase 6
   vars (`OWNER_EMAIL`, `GOOGLE_CLIENT_ID` / `SECRET`, `GITHUB_CLIENT_ID`
   / `SECRET`, `TURNSTILE_SITE_KEY` / `SECRET_KEY`,
   `DAILY_TOKEN_BUDGET_FREE` / `_TRUSTED`) once multi-user lands.
6. `systemctl enable --now macrotide`, `systemctl reload caddy`.
7. Visit the URL — create an account, register a passkey, done. (Or sign
   in with Google/GitHub once Phase 6 ships.)

**Optional hardening:**

- Put **Cloudflare** in front (free tier) for DDoS + bot scraping protection.
- **Fail2ban** on `/api/auth/*` if you see brute-force attempts in logs.
- Move SQLite to a dedicated block volume so the boot volume isn't your
  single point of data loss.

### What this is not

- **Not Vercel-deployable as-is.** SQLite + serverless = ephemeral filesystem.
  To run on Vercel, swap the DB to Turso (libSQL) — one Drizzle config change
  thanks to the portable schema rules in Phase 1.
- **Not horizontally scalable.** Single VM only. SQLite is one writer. If you
  ever need multiple app instances, that's the Turso / Postgres trigger
  point, and a different architecture conversation.

---

## Decisions made (was: "before Phase 1")

Locked decisions, kept here so re-cloners and future-you don't re-litigate.

| Decision | Picked | Why not |
| --- | --- | --- |
| ORM | Drizzle | Prisma heavier; raw SQL loses types |
| Client data layer | SWR | React Query overkill for this scale |
| AI provider | Vercel AI SDK + OpenRouter | Direct Anthropic SDK locks to one provider |
| Chat model | `AI_MODELS` env (comma-separated fallback chain), `openrouter/auto` default | Hardcoding one model means a one-string change every model bump |
| Auth library (Phase 2.5 + 6) | better-auth + passkey + Google/GitHub social (Phase 6) | NextAuth v5 heavier, Clerk vendor lock-in, Auth0 vendor cost |
| Email transport | **Skip entirely** — Phase 6 uses Google/GitHub SSO only, no magic link | Resend free-tier is fine but DNS + spam-folder UX is friction for a soft-public launch |
| Market data: Thai funds | Thai SEC Open API (Phase 3b) — official, free with subscription key | Scraping private fund supermarkets — TOS/legal exposure for an experimental app |
| Public sign-up bot defense (Phase 6) | Cloudflare Turnstile | hCaptcha works too; Turnstile is already in the zone |
| Admin tooling (Phase 6) | SQL first; build `/admin` UI only if SQL friction shows up | better-auth's `admin` plugin is there when needed |

## Explicitly out of scope (until you decide otherwise)

- **Open SaaS / billing / admin UI** — Phase 6 opens public sign-up but new
  accounts default to free-tier-only and admin happens via SQL. No paid
  tiers, no self-serve upgrade flow, no admin web UI.
- **Horizontal scaling / multi-region** — single VM, single SQLite writer. If
  that ever changes, the trigger is migrating to Turso or Postgres, not
  layering on top of SQLite.
- **Broker scraping / unofficial APIs** — high maintenance burden, defer to
  Phase 4b when you have a clear need.
- **Aesthetic overhaul** — handled inline per phase. After each phase, walk
  through the screens once and note rough edges where real data exposed them.
- **News / research / earnings feeds** — defer until the chat is good enough
  that you'd actually use them.
- **Mobile-native app / PWA** — desktop / mobile web only.
- **Notifications / digests / scheduled runs** — Phase 5b if ever.
- **Enterprise SSO (SAML/OIDC), org accounts, magic-link email** — see
  Phase 6's "What stays out of scope" for why.

## When to revisit aesthetics

After each phase, look for:

- **Phase 1 done**: empty-state designs for screens that previously couldn't
  be empty (Journal with 0 entries, Buckets with 0 holdings).
- **Phase 2 done**: streaming UI density, citation/tool-call card design,
  proposal card design.
- **Phase 2.5 done**: sign-in screen polish, passkey-registration prompt
  after first OAuth sign-in.
- **Phase 2.6 done**: thread-list density, plan-edit Apply micro-animation,
  empty-state for "no chats yet".
- **Phase 6 done**: quota-exceeded message in chat, account/profile UI
  (name + sign out + revoke passkeys + linked OAuth providers), Turnstile
  widget placement, ToS/privacy footer.
- **Phase 3 done**: chart tooltips, time-range chips, missing-data graceful
  degradation.
- **Phase 4 done**: import flow polish (drag-and-drop affordance, OCR
  confirmation UX), error states.

## Doc stewardship

Stale docs are this project's #1 failure mode. Every code change that ships
a feature **must** include the matching doc update. Treat docs as part of
the PR, not a follow-up.

| When you change… | Update… |
| --- | --- |
| A phase's deliverables | [ROADMAP.md](./ROADMAP.md) — phase section + "Phases at a glance" table |
| Status / what works today | [README.md](./README.md) Status block + project-layout block if files moved |
| Env vars | [.env.example](./.env.example) + [AUTH.md](./AUTH.md) + [DEPLOY.md](./DEPLOY.md) + [AGENTS.md](./AGENTS.md) (env var table) |
| Auth or security posture | [SECURITY.md](./SECURITY.md) + [AUTH.md](./AUTH.md) |
| Deployment topology / systemd / Caddy | [DEPLOY.md](./DEPLOY.md) |
| Conventions an AI agent must know | [AGENTS.md](./AGENTS.md) |
| External data source (provider, API) | [ROADMAP.md](./ROADMAP.md) Phase 3/3b "Sources" + [SECURITY.md](./SECURITY.md) if it touches auth |

If a doc references a function, env var, or file path, that reference is a
contract. When you rename / move / delete it, grep the docs:

```bash
grep -rn "thing_being_renamed" *.md
```

Verify after writing the change: open each doc you touched and read the
section end-to-end. Stale doc lines tend to cluster in the same paragraph
that was edited.

## Next session pickup

1. `cd macrotide` and re-read this file.
2. **Where we are (2026-05-22):** Phase 3b in flight (provider refactor +
   Thai SEC Open API integration), thread-list sidebar shipping in the
   same pass. Phase 5 sketched but research-gated.
3. **What to pick next:**
   - **Phase 4 OCR import** — solid follow-on once 3b lands; needs no big
     decisions, uses Claude vision via OpenRouter.
   - **Phase 5a (memory)** — pick this if user appetite is "make chat
     feel personal" before opening multi-user. Re-validate library
     choices first.
   - **Phase 6 (multi-user)** — when ready to share with family/friends.
     One-way door on schema; only start when committed.
