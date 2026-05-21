# Roadmap

> **Status:** Active. The working plan for turning the static-data prototype
> into real software. Last updated 2026-05-21 (Phase 2 scaffold + multi-user
> + per-session demo landed).

---

## State of the world

**Phase 1 is shipped.** As of 2026-05-21:

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
- 15 vitest tests including AsyncLocalStorage isolation + provider routing.

**Phase 2.5 scaffold shipped** (multi-user mode + demo button):

- better-auth + `@better-auth/passkey` with drizzle-adapter against the same
  SQLite. Endpoints at `/api/auth/[...all]`.
- `/onboarding` screen — passkey sign-in, account creation (registers a
  passkey on first sign-up), or "Try the demo".
- `AUTH_REQUIRED=1` gates the dashboard on a session cookie. Demo cookie
  bypasses the gate.
- **Per-session demo DBs** — each demo gets its own isolated in-memory
  SQLite seeded with mock data. AsyncLocalStorage routes every query to the
  right DB. Idle TTL 1h, hard cap 200 concurrent. Real users still share
  the owner SQLite (single-tenant for now).

**Phase 3 partial:** Yahoo Finance client + cache + `/api/market/indices`;
MarketsScreen pulls live SET / S&P / Nasdaq / Nikkei / USD-THB with 24h
cache and graceful 429 fallback. News, digest, learn content, and Thai
mutual-fund NAVs still mocked (no public API; AIMC or scrape is a later
pass).

What's still mocked: ANALYSIS scores (need AI tool-calls — Phase 2.6),
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

| # | Phase | Status | Unlocks |
| - | --- | --- | --- |
| 1 | Persistence | ✅ Shipped 2026-05-21 | State survives reloads. Real schema forces honest data shapes. |
| 2 | AI chat | Pending (needs OpenRouter key) | The "wow" moment. App becomes useful. |
| 2.5 | Multi-user mode (opt.) | Pending (needs deploy decision) | Self-host to a remote VM for shared use. Skip on localhost. |
| 3 | Market data | 🟡 Partial — indices live; funds + news deferred | Charts show real prices. Chat can reason about live market. |
| 4 | Portfolio import | 🟡 Partial — CSV / paste / manual live; OCR pending AI key | App holds **your** money, not demo money. |

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
   into the DB. Add `npm run seed`. Wipes + reseeds for dev sanity.
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
- `lib/mock/data.ts` no longer imported by any screen (only by `seed.ts`).
- `data/app.db` and `data/backups/` are in `.gitignore`.
- App boot creates a backup in `data/backups/` if the last one is >24h old;
  backups older than 30 days are pruned.
- Typecheck + build pass.

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

## Phase 2.5 — Multi-user mode (optional)

**Goal:** the app can run in either **single-user mode** (default — no auth,
localhost) or **shared-deployment mode** (auth enabled, multiple sessioned
users sharing a server-side AI key). Localhost users skip this phase. Required
before deploying to a remote VM.

### Stack pick

- **[better-auth](https://www.better-auth.com/)** — TypeScript-first, modern,
  actively maintained, Drizzle-native. Replaces the deprecated Lucia.
- **Sign-in methods (both, user picks at sign-in):**
  - **Passkey** (`@better-auth/passkey` plugin) — WebAuthn, primary method
    after first sign-in. Phishing-resistant, no shared secret, works on
    iOS / Android / desktop via platform authenticators.
  - **Email magic link** (`@better-auth/magic-link` plugin) — bootstrap for
    first sign-in and fallback when a user is on a device without their
    passkey. Email via Resend free tier (3K/month, no SMTP setup).
- **Why not NextAuth/Auth.js v5:** heavier, more opinionated, perpetual beta.
- **Why not Clerk:** vendor lock-in for an OSS project; free-tier MAU limit.

### The "server-side AI key" pattern

```
[user browser] → [API route on this server] → [OpenRouter]
                    ↑ has OPENROUTER_API_KEY in env
                    ↑ verifies session before forwarding
                    ↑ enforces per-user token quota
```

The OpenRouter key never leaves the server. Users never see it. All chat
turns go through the API route, which:

1. Verifies the better-auth session cookie.
2. Loads the user's daily token usage (`usage` table).
3. Refuses the turn if over quota; otherwise forwards to OpenRouter.
4. After the stream completes, updates `usage` with input/output tokens
   (the AI SDK exposes `usage` in the final chunk).

### Schema additions

```sql
-- better-auth handles its own tables (user, session, account, verification,
-- passkey). Run `npx @better-auth/cli generate` to emit Drizzle schema for
-- these — keep them in lib/db/schema/auth.ts, separate from app tables.

-- Per-user daily usage cap (your tables)
CREATE TABLE usage (
  user_id TEXT NOT NULL REFERENCES user(id),
  date TEXT NOT NULL,                 -- YYYY-MM-DD
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- App tables that were single-user become per-user
ALTER TABLE buckets ADD COLUMN user_id TEXT REFERENCES user(id);
ALTER TABLE journal_entries ADD COLUMN user_id TEXT REFERENCES user(id);
ALTER TABLE plans ADD COLUMN user_id TEXT REFERENCES user(id);
ALTER TABLE chat_threads ADD COLUMN user_id TEXT REFERENCES user(id);
-- model_portfolios: keep built-ins user-less; user-defined get user_id.
```

In single-user mode, `user_id` columns are NULL — all queries filter
`WHERE user_id IS NULL OR user_id = $session_user`.

### Configuration

Env vars (documented in `.env.example`, neutral framing — no mention of
who the users are):

```
AUTH_ENABLED=false                  # default; flip to true for shared deploy
AUTH_ALLOWED_EMAILS=a@b.com,c@d.com # comma-separated allowlist; only these emails can sign up
AUTH_SECRET=...                     # better-auth signing key
RESEND_API_KEY=...                  # only required if magic-link enabled
PUBLIC_APP_URL=https://...          # canonical URL for magic-link callbacks + passkey rpID
DAILY_TOKEN_BUDGET_PER_USER=200000  # input+output tokens/user/day; 0 = unlimited
```

The allowlist is the simplest way to keep the deployment closed without
building an admin UI. To add someone, edit the env var and restart.

### File layout

```
lib/
  auth/
    server.ts             # betterAuth() instance + plugins (passkey, magicLink)
    middleware.ts         # session check helper for API routes
    config.ts             # reads AUTH_ENABLED + allowlist; exposes isAuthEnabled()
  db/
    schema/
      auth.ts             # generated by @better-auth/cli
      app.ts              # existing tables, with user_id added
  usage/
    quota.ts              # readUsage(userId), recordUsage(userId, in, out), isOverQuota()

app/
  api/
    auth/[...all]/route.ts  # better-auth catch-all handler
  (auth)/
    sign-in/page.tsx      # passkey button + "email me a link" fallback
    callback/page.tsx     # magic-link landing
```

### Implementation order

1. `npm install better-auth @better-auth/passkey @better-auth/magic-link resend`.
2. `lib/auth/server.ts` — `betterAuth({...})` with Drizzle adapter, passkey
   plugin (`rpName: "Tidemark"`, `rpID: PUBLIC_APP_URL host`), magic-link
   plugin (Resend sender).
3. `npx @better-auth/cli generate` → emits `lib/db/schema/auth.ts`. Commit it.
4. `drizzle-kit generate` → migration for auth tables + `user_id` columns +
   `usage` table.
5. `app/api/auth/[...all]/route.ts` — wire the catch-all.
6. Sign-in page: passkey button (primary) + "email me a link" link (fallback).
   First-time users hit magic link → land authenticated → prompted to
   register a passkey for next time.
7. `lib/auth/middleware.ts` — `requireUser(req)` helper. If `AUTH_ENABLED`,
   verify session; else return a synthetic single-user. Use in every API
   route.
8. Update every Drizzle query in `lib/db/queries/*` to take `userId` (or
   `null` for single-user). Add `WHERE user_id = ?` filters.
9. `lib/usage/quota.ts` + wire into `app/api/chat/route.ts`. Refuse turns
   when over quota; show clear error in chat UI.
10. `.env.example` updated. README's "Modes" section added.

### Acceptance criteria

- With `AUTH_ENABLED=false`, app behaves exactly as Phase 2 (no login screen,
  no friction).
- With `AUTH_ENABLED=true`:
  - First sign-in via magic link works end-to-end (request → email → click →
    authenticated session).
  - Authenticated user can register a passkey; subsequent sign-ins use it
    with no email step.
  - Two browser sessions for two different allowed emails see fully isolated
    portfolios, journals, and chat history.
  - Hitting daily token quota returns a clear error in the chat UI; usage
    resets at UTC midnight.
- `OPENROUTER_API_KEY` is never exposed to the browser (verify via DevTools
  → Network → response headers).
- Repo docs frame this as "single-user / shared deployment" — no mention of
  specific user groups.

### Risk

- **Email deliverability:** Resend's free tier requires domain verification
  for production. Until that's done, sign-in emails may hit spam. Document
  the verification step in deployment instructions.
- **Passkey `rpID` mismatch:** if `PUBLIC_APP_URL` changes (e.g., temporary
  staging domain), existing passkeys break. Pin the production URL early.
- **Allowlist drift:** restarting to add a user is awkward. Acceptable at
  small scale; revisit if it ever becomes friction.

---

## Phase 3 — Market data

**Goal:** the charts on PortfolioScreen and MarketsScreen show real prices.
The `read_market_view` tool gives the model live data.

### Sources

| Data | Provider | Notes |
| --- | --- | --- |
| SET index + Thai stocks | Yahoo Finance `^SET.BK` via `query1.finance.yahoo.com` | No auth. Polite caching mandatory (24h for history, 5min for last). |
| US indexes / global ETFs | Yahoo Finance | Same. |
| Thai mutual fund NAVs | AIMC (Association of Investment Management Companies) public data, or scrape fund-supermarket pages with Playwright | Slowest, most fragile. Cache 24h. |
| FX rates (THB/USD) | exchangerate.host or Yahoo | Daily cache. |

> **Defer**: news / earnings calendars / macro feeds. The chat tool surface
> doesn't need them yet, and they bloat scope.

### File layout

```
lib/
  market/
    yahoo.ts                # generic Yahoo chart endpoint client
    set-index.ts            # convenience wrapper for ^SET.BK + sectors
    fund-platform.ts        # Thai fund NAV scraper (Playwright)
    fx.ts                   # FX rates
    cache.ts                # SQLite-backed cache (fund_quotes + nav_history tables from Phase 1)
    types.ts

app/
  api/
    market/
      set/route.ts          # GET ?range=1m|3m|1y
      fund/[ticker]/route.ts
      fx/route.ts
```

### Implementation order

1. `lib/market/cache.ts` — read/write `fund_quotes` + `nav_history` from
   Phase 1.
2. `lib/market/yahoo.ts` — generic fetcher with retry + Yahoo's quirky CSRF.
3. `lib/market/set-index.ts` + `app/api/market/set/route.ts`.
4. Wire `MarketsScreen` charts to fetch real series.
5. `lib/market/fund-platform.ts` (Playwright scraper for Thai fund NAVs).
   Run as a `npm run refresh-navs` script first; later move to a scheduled job
   (Phase 5).
6. `app/api/market/fund/[ticker]/route.ts` returns NAV + history from cache,
   triggers a scrape if cache is cold.
7. Update Phase-2 `read_market_view` tool to call real endpoints.
8. PortfolioScreen perf chart: portfolio value vs benchmark, normalized to
   100, using real NAV history.

### Acceptance criteria

- MarketsScreen shows live SET index + at least 4 holdings with real NAVs.
- Chat: *"How did my portfolio do vs SET this quarter?"* — answer uses real
  numbers.
- Cache headers / DB timestamps prevent re-fetch within TTL.
- Charts gracefully render when NAV history is partial (e.g. <90 days).

### Risk

- **Yahoo blocks**: rare but happens. Have a retry + UA rotation. If it
  becomes painful, swap to Alpha Vantage (free tier 25 calls/day; enough for
  a daily refresh).
- **Fund-supermarket page changes**: scrapers break. Keep selectors in one
  file; failure mode is "stale cache + log warning," not "crash."

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
2. **Image OCR**.
   - `lib/portfolio/ocr.ts`: send image to Claude with a strict JSON schema
     prompt → return `{ proposed_rows: [...] }`.
   - `app/api/import/image/route.ts`.
   - Wire the Image tab. Show proposed rows in a confirmation table; user
     edits + saves.
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

### Mode B — shared self-host (multi-user, single VM)

Targets a single Linux VM (any cloud VPS or home server). Requires Phase 2.5.

**Stack on the VM:**

- **Node 24** (use `nvm` or the distro's nodesource repo).
- **Caddy** as reverse proxy — automatic HTTPS via Let's Encrypt, ~5-line
  Caddyfile. No certbot, no Nginx config tedium.
- **systemd** to keep the Node process alive across reboots. PM2 is fine too
  if you prefer a friendlier UX.
- **SQLite file** at `/opt/tidemark/data/app.db`. Daily backups via the
  existing `lib/db/backup.ts`; mirror to an off-VM object store (e.g.
  Cloudflare R2 — 10 GB free, no egress) via `rclone` cron.

**Caddyfile (the whole thing):**

```caddyfile
tidemark.example.com {
    reverse_proxy localhost:3000
}
```

**systemd unit (sketch, `/etc/systemd/system/tidemark.service`):**

```ini
[Unit]
Description=Tidemark
After=network.target

[Service]
WorkingDirectory=/opt/tidemark
EnvironmentFile=/opt/tidemark/.env
ExecStart=/usr/bin/node node_modules/.bin/next start -p 3000
Restart=always
User=tidemark

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
5. Create `/opt/tidemark/.env` with `AUTH_ENABLED=true`,
   `AUTH_ALLOWED_EMAILS`, `AUTH_SECRET`, `PUBLIC_APP_URL`,
   `OPENROUTER_API_KEY`, `RESEND_API_KEY`, `DAILY_TOKEN_BUDGET_PER_USER`.
6. `systemctl enable --now tidemark`, `systemctl reload caddy`.
7. Visit the URL — sign in via magic link, register a passkey, done.

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

## Decisions you need to make before Phase 1

| Decision | Default | Alternative |
| --- | --- | --- |
| ORM | Drizzle | Prisma (heavier), raw SQL (no types) |
| Client data layer | SWR | React Query, plain fetch + setState |
| AI provider | Vercel AI SDK + OpenRouter | Anthropic SDK direct (locks to one provider) |
| Chat model | TBD — decide after first real calls | Sonnet 4.6, GPT-5, etc. via OpenRouter (one-string change) |
| Auth (Phase 2.5) | better-auth + passkey (primary) + magic link (fallback) | NextAuth v5 (heavier), Clerk (vendor lock-in), hand-rolled (more code) |
| Email transport | Resend free tier (3K/month) | SMTP via Postmark / SES if Resend caps bite |
| Market data: Thai funds | Playwright scrape of fund-supermarket pages | AIMC public data feed |

## Explicitly out of scope (until you decide otherwise)

- **Public sign-ups** — multi-user mode (Phase 2.5) is allowlist-gated, not
  open. No SaaS, no billing, no admin UI.
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
- **Notifications / digests / scheduled runs** — Phase 5 if ever.

## When to revisit aesthetics

After each phase, look for:

- **Phase 1 done**: empty-state designs for screens that previously couldn't
  be empty (Journal with 0 entries, Buckets with 0 holdings).
- **Phase 2 done**: streaming UI density, citation/tool-call card design,
  proposal card design.
- **Phase 2.5 done**: sign-in screen polish, passkey-registration prompt,
  quota-exceeded message in chat, account/profile UI (minimal — name + sign
  out + revoke passkeys).
- **Phase 3 done**: chart tooltips, time-range chips, missing-data graceful
  degradation.
- **Phase 4 done**: import flow polish (drag-and-drop affordance, OCR
  confirmation UX), error states.

## Next session pickup

1. `cd tidemark` and re-read this file.
2. Confirm the **Decisions you need to make** table above (Drizzle / SWR /
   Anthropic SDK / Sonnet 4.5).
3. Start Phase 1, step 1: `npm install better-sqlite3 drizzle-orm` etc.
4. The smallest useful loop in Phase 1 is: **schema → migrations → seed →
   replace one screen's mock import with a real fetcher**. Pick
   `PortfolioScreen` for that one screen.
