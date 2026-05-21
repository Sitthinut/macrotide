# Roadmap

> **Status:** Active. The working plan for turning the static-data prototype
> into real software. Last updated 2026-05-20.

---

## State of the world

The prototype is functionally complete:

- 7 screens (Portfolio, Markets, Chat, Journal, Models, Connect, Settings)
- Responsive shell (mobile <700 / tablet 700-1199 / desktop ≥1200)
- Direction-C aesthetic, light/dark/system themes
- Mobile bottom nav + wide-shell left rail + right-dock apps panel (Chat /
  Buckets / Plan / Notes)
- All data lives in `lib/mock/data.ts`. All AI is mock. No persistence.

The prototype looks finished but does nothing. This plan turns it into software.

## Why this build order

Easiest → hardest, lowest risk → highest risk:

1. **Persistence** — mechanical, no third-party unknowns, unlocks everything.
2. **AI chat** — highest user-visible value once persistence is in.
3. **Market data** — moderate plumbing; needed to make charts real.
4. **Portfolio import** — hardest because brokerage data sources are unreliable.

Aesthetics deliberately come last (and inline, not as a phase). Real data
exposes the gaps that need polish; polishing on mock data risks rework.

## Phases at a glance

| # | Phase | Effort | Unlocks |
| - | --- | --- | --- |
| 1 | Persistence | 1–2 days | State survives reloads. Real schema forces honest data shapes. |
| 2 | AI chat | 2–3 days | The "wow" moment. App becomes useful. |
| 3 | Market data | 1 day | Charts show real prices. Chat can reason about live market. |
| 4 | Portfolio import | 2–3 days | App holds **your** money, not demo money. |

## Phase 1 — Persistence

**Goal:** every piece of state the user creates or edits survives a reload, and
the data layer is honest TypeScript (not module-level mutable mock).

### Stack pick

- **SQLite via `better-sqlite3`** (synchronous, embedded, zero-config) +
  **Drizzle ORM** (typed, migration-friendly, lightweight).
- Why not Prisma: heavier, slower codegen, opinionated CLI.
- Why not Supabase / Postgres: this is a personal app on localhost; cloud DB
  adds latency, auth, and an account dependency you don't need.
- Migration path: Drizzle's dialect-swap to Postgres is one config change if
  you ever go hosted.

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
    client.ts          # Drizzle + better-sqlite3 singleton (Node only)
    schema.ts          # Drizzle table definitions (one file, mirrors SQL above)
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
6. Pick one screen to migrate first — **start with `PortfolioScreen`** (the
   highest-stakes, most-visited screen).
   - Add the API routes it needs.
   - Add the fetchers.
   - Replace `import { PORTFOLIOS } from "@/lib/mock/data"` with
     `useBuckets()` / `useHoldings(bucketId)`.
   - Add loading + empty states (real DB can be empty; mock data never was).
7. Migrate remaining screens one at a time: Journal, Plan (in JournalScreen),
   Models, then the right-dock panels (BucketsPanel / PlanPanel / NotesPanel).
8. Settings: persist theme + selected model via `/api/settings`.

### Acceptance criteria

- `npm run dev` boots; DB file auto-created at `data/app.db`.
- Reload survives all user-created state: journal entries, plan edits,
  custom model portfolios, theme.
- `lib/mock/data.ts` no longer imported by any screen (only by `seed.ts`).
- `data/app.db` is in `.gitignore`.
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

- **Anthropic TypeScript SDK** (`@anthropic-ai/sdk`) directly, not Vercel AI
  SDK. Reasons:
  - One dependency, one provider, simpler tracing.
  - Native tool-use API is rich and easy to type.
  - Streaming is straightforward via the SDK's `stream()` helper.
- Model: **`claude-sonnet-4-5`** for chat (good reasoning, reasonable cost);
  drop to **`claude-haiku-4-5`** for utility tool calls if cost matters later.
- Env: `ANTHROPIC_API_KEY` in `.env.local` (gitignored).

> **Alternative considered:** OpenRouter, per the original prototype plan.
> Keeps provider swap easy. Worth keeping in your back pocket but Anthropic
> direct is simpler now.

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

1. `npm install @anthropic-ai/sdk zod`.
2. `lib/agent/system-prompt.ts` — paste a starter prompt; iterate after first
   real call.
3. `lib/agent/tool-schema.ts` — Zod for each tool's args.
4. `app/api/chat/route.ts` — streaming POST; reads thread history from DB,
   calls Anthropic with tools, handles tool-use loop server-side, persists
   messages.
5. `app/api/chat/tools.ts` — tool definitions (Anthropic SDK format).
6. `app/api/chat/execute.ts` — switch on tool name, call query fn, return JSON.
7. Wire `ChatScreen` to stream from the endpoint instead of using mock
   `setTimeout` responses. Use `EventSource` or Anthropic's streaming SDK
   client-side.
8. Render tool-call cards (collapsible, like Claude Code's tool-use blocks).
9. Render plan-edit proposal cards. Implement Accept / Reject buttons.
10. `lib/agent/proposals.ts` — accept writes new plan, archives old.

### Acceptance criteria

- ChatScreen + ChatPanel both stream real responses from Claude.
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
  get wrong; copy the Anthropic SDK example verbatim first.
- **Cost**: cap input context (don't dump all chat history; summarize beyond
  N turns).

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

## Decisions you need to make before Phase 1

| Decision | Default | Alternative |
| --- | --- | --- |
| ORM | Drizzle | Prisma (heavier), raw SQL (no types) |
| Client data layer | SWR | React Query, plain fetch + setState |
| AI provider | Anthropic SDK direct | OpenRouter (provider swap), Vercel AI SDK |
| Chat model | `claude-sonnet-4-5` | `claude-opus-4-5` (better reasoning, ~5× cost), `claude-haiku-4-5` (fast, cheap) |
| Market data: Thai funds | Playwright scrape of fund-supermarket pages | AIMC public data feed |

## Explicitly out of scope (until you decide otherwise)

- **Auth / multi-user / cloud hosting** — personal app, localhost only.
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
