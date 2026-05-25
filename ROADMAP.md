# Roadmap

> **Status:** Active. The working plan for turning the static-data prototype
> into real software. Last updated 2026-05-23 (Phase 5 shipped — 5a memory
> foundation + chat sidebar; 5b session lifecycle + real-time session-close extraction +
> chat summarization + recall/FTS. Memory design in
> [docs/explanation/memory.md](./docs/explanation/memory.md)).

---

## 🌙 Autonomous build run — live status (started 2026-05-23 night)

> ✅ **RUN COMPLETE — all 13 tasks merged and PUSHED to `origin/main`
> (2026-05-23).** Final state: typecheck clean, **251 tests passing**,
> production build compiles (25 routes), lint 0 errors. Review the log
> (`git log --oneline`) and the **⏳ Needs the user** checklist below.
> Tasks marked 🧪 are code-complete but need your browser/WebAuthn/live-LLM to
> verify (I can't drive a passkey or a real model from here).
>
> **This section is the durable source of truth for the overnight autonomous
> build.** The lead agent updates it as work lands, so if the session dies
> before the user returns, this table shows exactly what's done, what's on a
> branch, and what needs the user's hands.
>
> **Merge policy:** green waves are merged into `main` **locally and never
> pushed** (pushing is the user's call). Each wave is a foundation for the next,
> so merging is structural. Branches are `team/<slug>`.
>
> **Verification ceiling without the user:** typecheck + lint + build + unit/
> integration tests. Anything needing a real passkey / OAuth / browser is
> marked 🧪 and is NOT claimed as done.

**Status legend:** ⬜ not started · 🔨 in progress · ✅ merged to `main` (local,
unpushed) · 🧪 code-complete + tests green, needs user browser/WebAuthn
verification · ⏸️ needs a user decision before it can proceed.

### Wave 0 — immediate, no dependencies
| # | Task | Branch | Status | Notes |
|---|------|--------|--------|-------|
| 1 | Passkey signup fix (enable `emailAndPassword` bootstrap) | merged→`main` | 🧪 | ✅ merged (414d37a); typecheck/build green. 🧪 you do the final WebAuthn signup click to confirm |
| 2 | Session close-cycle integration tests | merged→`main` | ✅ | ✅ merged (d125352); 5/5 tests green on main. Done, no user action |
| 3 | `closeStaleSessions` runnable CLI (`tsx` + `npm run`) | merged→`main` | ✅ | ✅ merged (f56f773). Run: `npm run jobs:close-stale -- --dry-run` (or `--idle-days=N`). 11/11 tests green. Lead fixed a global-tsconfig `server-only` alias → scoped `tsconfig.scripts.json`. No scheduler (parked) |

### Wave 1 — FOUNDATION (solo, merges before Wave 2)
| # | Task | Branch | Status | Notes |
|---|------|--------|--------|-------|
| 4 | 6a Data layer — migration `0007` (user_id + `usage` + `account_tier`), `OWNER_EMAIL` backfill, per-user query filter, `userId` in AsyncLocalStorage, `requireUser()` | merged→`main` | ✅ | ✅ merged (8ad9157). 156/156 tests, build-clean. Backward-compatible (`ownedBy()` collapses to `user_id IS NULL` with no user). 🧪 you: apply migration `0007` to real DB + set `OWNER_EMAIL` + run `npx tsx --env-file=.env.local scripts/backfill-owner.ts` |

### Wave 2 — Phase 6 fan-out (after 6a merges)
| # | Task | Branch | Status | Notes |
|---|------|--------|--------|-------|
| 5 | 6b Identity — better-auth google/github (env-gated), `/login` buttons, post-OAuth passkey prompt | merged→`main` | 🧪 | ✅ merged (914c783). Env-gated: boots passkey-only with nothing set. 🧪 register OAuth apps (callbacks `<PUBLIC_APP_URL>/api/auth/callback/{google,github}`) + set 4 client vars + browser verify |
| 6 | 6d Quotas + tier gating — model-chain by tier, daily cap, usage logging, limit UI | merged→`main` | ✅ | ✅ merged (9ed504f). Free tier pinned to `openrouter/free` in code (can't resolve paid). 26 new tests. Active once a real user logs in; owner path unchanged. 🧪 browser-verify limit banner needs an auth'd user |
| 7 | 6c Sign-up gate — Turnstile (dev-bypass when unset), wire `AUTH_RATE_LIMIT`, `tier=free` default, first-user bucket seed, `/legal/*` + checkbox | merged→`main` | 🧪 | ✅ merged (914c783). Turnstile bypassed when `TURNSTILE_SECRET_KEY` unset. 11 auth tests. 🧪 get Turnstile keys; **review `/legal/terms` + `/legal/privacy` boilerplate** before public launch |
| 8 | 6e Account page — passkeys (revoke), linked providers, usage, sign-out-everywhere | merged→`main` | 🧪 | ✅ merged (6f0828d). Built as an `AccountScreen` (matches the app's screens-in-`App.tsx` pattern, not an app-router route); wired the dead "Account" menu button. 🧪 browser-verify passkey revoke + sign-out-everywhere |

### Wave 3 — Advisor actions + UX (after 6a; reviews can start anytime)
| # | Task | Branch | Status | Notes |
|---|------|--------|--------|-------|
| 9 | Phase 2 tool-call execution — read_portfolio/plan/journal, write_journal, propose_plan_edit; per-user scoped | merged→`main` | 🧪 | ✅ merged (7c86630). Tools in all 3 chat paths, `stepCountIs(5)`, 6d gating intact. 🧪 needs a live LLM + OPENROUTER key to verify tool-call streaming end-to-end |
| 10 | Plan-edit proposal cards — accept wired to new `POST /api/plan/edit` (`applyPlanEdit`+upsert, per-user) | merged→`main` | 🧪 | ✅ merged (7c86630). Reused `PlanProposalCard`; removed old fake-proposal regex. 🧪 browser-verify propose→card→Apply→plan updated |
| 11 | ANALYSIS composite score — transparent 0-100 from `health.ts` (drift 30/fees 25/concentration 25/cash 20), +per-component breakdown | merged→`main` | ✅ | ✅ merged (224b1c0). `lib/portfolio/score.ts`, 21 tests, deterministic (no LLM). ⚠️ known caveat: the HHI concentration component penalizes *intentional* uneven weighting (e.g. a 60/40 mix scores below equal-weight) — detail text explains it; tweak weights/rule if you disagree |
| 12 | Charts — **recharts** interactive charts w/ hover+tooltips (`InteractiveCharts.tsx`, `'use client'`) | merged→`main` | ✅ | ✅ merged (8b00b79). 🧪 eyeball the new charts in-browser |
| 13 | Plan & Health redesign — real signals in `lib/portfolio/health.ts` (drift, blended TER, concentration, cash drag, rebalance hint w/ good/watch/action tone) | merged→`main` | ✅ | ✅ merged (8b00b79). 21 health tests. ⚠️ **REMOVED visible mock cards** (sector roll-up, contributions, fabricated insights) as "mock theater" — no real data source; reinstatable as labeled placeholders if you want them. Also dropped mock series DRIFT_SERIES/CONTRIB_SERIES/GEO/SECTOR. 🧪 eyeball PortfolioScreen charts + Plan&Health panel (hover/tooltips, dark mode, empty/no-target states) |

### ⏳ Needs the user (collected — do these when you're back)
- Apply migration `0007` to the real `data/app.db` (after backup) + set `OWNER_EMAIL`, then run `npx tsx --env-file=.env.local scripts/backfill-owner.ts`.
- **Set `AUTH_SECRET` in `.env.local`** (`openssl rand -base64 32`). Discovered during this run: `npm run build` (production mode) currently FAILS without it — pre-existing since Phase 2.5, not new. Dev (`npm run dev`) works via the fallback secret; production build/deploy needs a real one.
- Register Google + GitHub OAuth apps → set `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`.
- Get Cloudflare Turnstile keys → `TURNSTILE_SITE_KEY/SECRET_KEY`.
- Browser/WebAuthn verification of: passkey signup (#1), OAuth sign-in (#5), account page passkey revoke (#8), tool-call actions (#9).
- Review legal copy in `/legal/terms` + `/legal/privacy` (#7).
- Decide scheduler/cron for the digest sweep (Phase 5b — out of this run).

### ▶️ How to resume if my session died
1. `git branch --list 'team/*'` — each completed task is a committed branch.
2. Check this table's Status column for what merged vs. what's still on a branch.
3. All 13 tasks are merged and pushed to `origin/main` (2026-05-23). No `team/*` branches remain.

---

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

## Documentation conventions

The roadmap is the **what** and **when**; detailed feature designs live
under `docs/`. We keep the layout flat and one-file-per-feature so
visitors (and future-you) can find anything in one click.

```text
README.md                       front door; value prop, quick start
ROADMAP.md                      phase plan + status (this doc)
AGENTS.md                       agent conventions (DB routing, demo, env)
docs/
  overview.md                   what Macrotide is, who it's for
  architecture.md               system diagram + data flow
  features/                     one file per shipped or in-design feature
    memory.md                   long-term memory + chat sessions
    chat.md                     chat panel + streaming + tools
    portfolio-analysis.md
    advisor-assist.md
    ...
  decisions/                    optional ADRs for genuinely contentious calls
  reference/                    schema + API once stable enough to publish
```

**Rules of thumb:**

- A feature gets its own file once it has a real implementation; rationale
  goes inside the feature doc, not as a separate ADR (unless the decision
  is contentious enough to warrant a permanent record).
- Cap each feature doc around 600 lines. Past that, split into a folder
  (`features/memory/overview.md`, `features/memory/schema.md`).
- Research notes (library surveys, etc.) stay local — they age fast and
  dilute the durable record.
- Guide docs live under `docs/` (Diátaxis: `tutorials/`, `how-to/`,
  `reference/`, `explanation/`). Only convention-mandated files stay at the
  repo root: `README.md`, `AGENTS.md`, `SECURITY.md`, `ROADMAP.md`, `LICENSE`.
- Publishing layer (GitBook / MkDocs) gets added once we have ~5+ feature
  docs worth surfacing publicly. Until then, GitHub's markdown renderer
  is fine.

**Update cadence:** docs change with the code that touches them, same PR.
A polish-pass phase will eventually do the comprehensive rewrite, but the
running rule is "if you ship a behavior change, update the feature doc."

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

**Phase 3b polish 2026-05-23:** demo seed now pre-generates synthetic
6-month NAV history per holding (log-space Brownian bridge, deterministic
per-ticker PRNG, weekday-only) so PerfChart renders instantly on first
demo load instead of waiting ~45s for the Thai SEC API to populate the
cache one ticker at a time. See [lib/mock/demo-seed.ts](./lib/mock/demo-seed.ts).

**Phase 4 OCR shipped 2026-05-23** (raw-text transcription, not structured rows):

- `lib/portfolio/ocr.ts` uses `generateText` (not `generateObject`) against
  an OpenRouter vision model. Returns `{ text: string }` — the raw
  transcription. Default chain: `baidu/qianfan-ocr-fast:free` → falls back
  to paid `baidu/qianfan-ocr-fast` on quota / rate-limit. Both via
  `OCR_MODEL` / `OCR_FALLBACK_MODEL` env.
- `app/api/import/image/route.ts`: multipart POST, 5 MB cap, JPG/PNG/WebP,
  10 RPM rate-limit. 503 when API key missing; 502 with the provider's
  `error.metadata.raw` message when the OpenRouter call fails.
- `AddHoldingsSheet` Image tab: shows the transcription with a Copy
  button and a prompt directing the user to the Manual tab or chat. No
  editable rows table; no save action on this tab.
- v3 of three iterations — v1 (strict structured rows + units required) and
  v2 (relaxed rows + optional units) both failed because cheap vision
  models can't both OCR and produce structured output reliably. v3 splits
  the labor.
- Production caveat: free-tier providers train on submissions. The
  qianfan `:free` variant is operator-verified no-train (per OpenRouter,
  2026-05-23) but re-verify before any public deploy and override
  `OCR_MODEL` to a paid no-train model for prod.
- Advisor-assist follow-up (Phase 6 gated): the Image tab will auto-hand
  the transcription to a chat thread and surface only `propose_holding`
  cards to the user — the raw OCR text stays intermediate state. See
  Phase 4 § "Follow-up: advisor-assist OCR".

**Env-var documentation centralized 2026-05-23:** [AGENTS.md § Environment
variables](./AGENTS.md) is now the canonical reference for every
`process.env.*` the app reads (14 vars). Grouped by category with default,
code location, and behavior notes. `.env.example` is the operator setup
template; AGENTS.md is the authoritative reference.

What's still mocked: ANALYSIS scores (need AI tool-calls — Phase 6),
ANALYSIS chart series (can be wired now — nav_history exists in demo;
needs only the queries + adapter), market news (Phase 3b), benchmark +
drift + contrib series on PortfolioScreen.

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
| 2 | AI chat | 🟢 Tool-calls shipped 2026-05-23 | streaming + history + **advisor tool-calls** (read_portfolio/plan/journal, write_journal, propose_plan_edit) + **plan-edit proposal cards** (→ `POST /api/plan/edit`) + **ANALYSIS composite score**. 🧪 live-LLM browser verify (see autonomous-run §) |
| 2.5 | Passkey + demo | ✅ Shipped 2026-05-21 | Single-owner auth + per-session in-memory demo DB |
| 2.6 | Cleanup & chat persistence | ✅ Shipped 2026-05-22 | Chat history persists; plan-edit Apply wired; mock-import migration done. Thread-list sidebar deferred to a polish pass |
| 3 | Market data | 🟡 Partial | SET/global indices live; funds + news in 3b |
| 3b | Fund NAVs + news + NAV history | ✅ Shipped 2026-05-23 | Provider + v2 endpoints + holdings.quote_source + PortfolioScreen wiring all live; demo NAV history pre-seeded (chart fills instantly); RSS news shipped as Phase 3c |
| 4 | Portfolio import | 🟡 Partial | CSV done; Image OCR shipped 2026-05-23 as pure transcription (qianfan:free → paid fallback); manual-entry ticker autocomplete shipped 2026-05-22 (`lib/data/known-funds.ts` seed + holdings dedupe); advisor-assist OCR (auto-handoff to chat with `propose_holding` cards) gated on Phase 6 |
| 4b | Broker scraping / API integration | Out of scope | Revisit only if a clear personal need emerges |
| 5 | Long-term memory + chat archival | ✅ 5a+5b shipped 2026-05-23 | **5a** — bitemporal `user_preferences` + 4-tool surface + always-on injection + Settings → Memory + chat sidebar (auto-title, 30-day trash, in-panel list) + empty-turn fail-safe. **5b** — session lifecycle (active/idle/archived); **real-time session-close extraction** (incremental, watermark `extracted_through_id` migration `0006`, running-summary context; `closeStaleSessions` backstop) writing `source='extracted'` + confidence floor; chat summarization at ~80% context (migration-free `role='summary'`, banner); `recall_preferences` tool + sidebar FTS. **5c+** (vector recall / offline consolidation) future. Guide: [docs/explanation/memory.md](./docs/explanation/memory.md); prior-art: [docs/explanation/research/memory-systems.md](./docs/explanation/research/memory-systems.md) |
| 5b | Scheduled jobs / digests / notifications | Pending | Depends on 3b and 6 |
| 6 | Multi-user (Google + GitHub SSO + passkey, public-discoverable) | 🟡 Code shipped, owner set up; needs OAuth/Turnstile + verify | **6a–6e code merged** + fail-closed scoping & per-user plans hardening (migration `0008`, 2026-05-24). Owner setup done: `AUTH_SECRET` set, `0007`+`0008` applied, `OWNER_EMAIL` backfill run → owner is `trusted`. 🧪 user still must: register OAuth apps, get Turnstile keys, review `/legal/*`, browser-verify (incl. per-user isolation). Remaining build: owner admin tier UI (should-do). |

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
  loopback dev only. See [auth-and-providers.md](./docs/reference/auth-and-providers.md), [SECURITY.md](./SECURITY.md).
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
- ✅ **News (RSS) — shipped as Phase 3c** — long-term-investing editorial
  feeds power the MarketsScreen news block via `/api/market/news`. See
  [Phase 3c — RSS news aggregator](#phase-3c--rss-news-aggregator) below.

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
  [deploy.md](./docs/how-to/deploy.md).
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

## Phase 3c — RSS news aggregator

> **Status:** ✅ Shipped 2026-05-23. Replaces the editorial mock news block
> on MarketsScreen with a real RSS aggregator.

**Goal:** the "From the long-term investing desk" block on MarketsScreen
shows real, fresh headlines from a small curated set of editorial sources
that match this app's index-investing / long-horizon advisor stance. No
day-trader headline noise.

### What shipped

- [lib/market/news.ts](./lib/market/news.ts) — RSS 2.0 + Atom 1.0
  aggregator. Fetches feeds in parallel with `Promise.allSettled` so one
  bad feed never kills the response. Normalizes items to
  `{ id, title, url, source, publishedAt }`, dedupes by URL, sorts
  newest-first, caps at 30 items. 30-minute in-memory TTL keyed by the
  feed list — no DB table. 8s per-feed fetch timeout.
- [app/api/market/news/route.ts](./app/api/market/news/route.ts) — GET
  handler wrapped in `withDb` for consistency with the rest of `/api/*`
  (read-only; the wrapper is harmless). 30 RPM IP rate-limit.
- [components/screens/MarketsScreen.tsx](./components/screens/MarketsScreen.tsx)
  — news section consumes the new `useMarketNews()` SWR fetcher. Cards
  link out to the source URL. Graceful empty state when all feeds fail.
  Shows a "N sources down" hint when partial.
- Vitest suite: 15 cases covering RSS / Atom parsing (with CDATA),
  dedupe by URL, sort by date (undated items sort last), 30-item cap,
  partial-failure resilience, all-fail empty state, cache hit + TTL
  expiry. **No live network calls in tests** — all fixtures synthetic.

### Feed list

| Source | URL | Why |
| --- | --- | --- |
| Of Dollars and Data | `https://ofdollarsanddata.com/feed/` | Nick Maggiulli's long-form data-driven investing posts. |
| A Wealth of Common Sense | `https://awealthofcommonsense.com/feed/` | Ben Carlson's index-investing commentary. |
| Bangkok Post Business | `https://www.bangkokpost.com/rss/data/business.xml` | Thai macro lens (rates, baht, fiscal). |
| Federal Reserve · Monetary Policy | `https://www.federalreserve.gov/feeds/press_monetary.xml` | FOMC statements, minutes, projections — authoritative rate-decision signal for rebalancing context. Low-volume (~15 items/year) by design. |

Sources audited and considered but **dropped:**

*v1 audit (philosophy / long-form round):*
- **Bogleheads forum** — high volume; "Re:" replies are thread-context
  noise without summaries.
- **MarketWatch top stories** — headline-driven mainstream finance; not
  the long-horizon voice.
- **Morningstar** — main domain `morningstar.com` returns HTTP 202 empty
  bodies to non-browser UAs (anti-bot tarpit); the surviving feedburner
  feed last updated October 2011. No working editorial RSS.

*v2 audit (market-context round):*
- **MarketWatch marketpulse / realtimeheadlines** — both technically parse
  but newest items date from mid-2025 (~10-11 months stale); the feeds
  appear abandoned.
- **Bloomberg markets** — feed works but content is dominated by
  company / CEO interviews rather than market-commentary.
- **Yahoo Finance `news/rssindex`** — high-volume, mixed clickbait with
  occasional market recaps; signal-to-noise too low.
- **Yahoo Finance `rss/2.0/headline`** — per-symbol only (requires
  `?s=SYMBOL`); not a market-wide feed.
- **CNBC markets** — daily trader / options noise (Nvidia options flow,
  software-stock mini-bull-markets) — exactly the headline style the
  app explicitly wants to avoid.
- **Reuters markets / business** — `reuters.com/markets/rss` is
  auth-gated (401) and `feeds.reuters.com` no longer resolves.
- **Federal Reserve press (all)** — `press_all.xml` works but mixes
  monetary-policy items with administrative / enforcement releases.
  Chose the narrower `press_monetary.xml` to keep signal tight.
- **Bank of Thailand** — no public RSS as of 2026-05-22. The new BOT
  site (URL pattern `/en/news-and-media/news/mpc/...`) does not expose
  feed-discovery links, robots.txt, or any `.xml` / `.rss` paths via
  the english sitemap. Bangkok Post Business remains the Thai-side
  window — they routinely cover MPC decisions.

When adding a new feed, audit it first against the bar above: HTTP 200,
parseable RSS/Atom, ≥10 recent items (≥1 item within ~4 months is fine
for naturally-low-volume sources like central-bank press releases),
editorial-not-headline.

### Dependencies

- **`fast-xml-parser`** added as a runtime dep. MIT, zero-dep,
  ~50KB. Approved for v1 (the obvious pick and there was no existing
  XML parser available transitively).

### Acceptance criteria

- `npm run typecheck` + `npm run lint` + `npm test` + `npm run build`
  all green.
- `GET /api/market/news` returns `{ items, failures, fetchedAt }` with
  at most 30 items, sorted newest-first.
- MarketsScreen renders headlines from real feeds; click-through opens
  the original article in a new tab.
- When every feed is unreachable, the section renders a friendly
  "temporarily unreachable" message — no crash, no empty card.
- Cache hits inside the 30-min window do not hit the network.

### Risk

- **Feed shape drift:** RSS / Atom variants are messy. Parser is
  defensive (skips bad items rather than throwing); ride out the
  occasional missing field with empty `publishedAt`.
- **Source decay:** any feed could die (paywall, abandonment). 30-min
  cache plus partial-failure resilience means one dead source quietly
  shows as "1 source down" in the UI. Replace dead feeds proactively
  when the count stays > 0.
- **No env-var override yet:** the feed list is a const in
  `lib/market/news.ts`. If the user wants per-deploy customization,
  that's a small follow-up — promote `NEWS_FEEDS` to read from env.

### Out of scope (Phase 3c)

- AI-generated `impact` / `relevance` per item — that's a Phase 6 tool-call
  layer ("score this headline against my plan"), not a feed concern.
- Article body text — feed metadata only. Following a link opens the
  source.
- Push notifications / digest emails — Phase 5b.

---

## Phase 4 — Portfolio import

**Goal:** the holdings shown in the app are **your real holdings**, not
seeded mock data.

### Three input paths (UI already scaffolded in `AddHoldingsSheet`)

1. **CSV upload** — easiest. User exports from broker / types into a file
   matching a small fixed schema (`ticker,name,units,avg_cost,acquired_on,account`).
2. **Image OCR** — user pastes a screenshot of their broker app; Claude vision
   reads it and proposes rows for confirmation.
3. **Manual entry** — ticker autocomplete shipped 2026-05-22. Static seed
   of ~30 publicly-known Thai funds + global indices/ETFs in
   `lib/data/known-funds.ts`, merged with distinct tickers from the
   user's existing holdings (those surface first, tagged · YOURS). Picking
   a suggestion fills ticker + `englishName` + `quote_source`. Substring
   match (case-insensitive) on ticker OR name; debounced 120 ms. No
   fuzzy-match library — substring is fine for the seed size.

Defer **broker scraping / API integration** — that's Phase 4b, only worth it
once you have a clear personal need.

### Implementation order

1. **CSV first** (the smallest useful loop).
   - `lib/portfolio/import.ts`: Zod schema, CSV parse via `csv-parse/sync`,
     upsert into `holdings` + `buckets`.
   - `app/api/import/csv/route.ts`: accepts `multipart/form-data`.
   - Wire the CSV tab of `AddHoldingsSheet`.
   - Sample file at `data/sample-holdings.csv`.
2. **Image OCR** (shipped 2026-05-22, redesigned to pure transcription 2026-05-23).
   - `lib/portfolio/ocr.ts`: `generateText` (not `generateObject`) call to
     an OpenRouter vision model → returns `{ text: string }` only — the
     raw transcription the model read from the image. Default model chain:
     `baidu/qianfan-ocr-fast:free` (zero cost, 27.2M tokens/week, operator-
     verified no-train) → falls back to `baidu/qianfan-ocr-fast` (paid,
     ~$0.004/call) on provider-unavailable errors (quota / rate limit /
     guardrail). Override either via `OCR_MODEL` / `OCR_FALLBACK_MODEL`.
   - **Why pure transcription, not structured rows.** Iteration history:
     v1 used `generateObject` with a strict Zod schema (`rows: ProposedRow[]`)
     and required units → returned zero rows on screenshots that hid units.
     v2 relaxed the schema (units optional) → still returned empty on dense
     screenshots because cheap vision models can't both OCR and structure
     reliably. v3 (current) gives each model one job: vision models transcribe;
     reasoning happens elsewhere (user → Manual tab today; advisor → Phase 6
     tool calls later). Bonus: works with OCR-specialized models like
     `baidu/qianfan-ocr-fast` that don't support OpenRouter's structured-output
     mode at all.
   - `app/api/import/image/route.ts`: multipart/form-data POST, 5 MB cap,
     JPG/PNG/WebP only, 10 RPM IP rate-limit. Returns 503 when
     `OPENROUTER_API_KEY` is unset. Returns 502 with the provider's
     `error.metadata.raw` message when the OpenRouter request fails (rate
     limit, guardrail policy, no available endpoint) — the UI surfaces this
     so the operator can act.
   - Image tab of `AddHoldingsSheet`: shows the transcription in a
     monospace block with a Copy button. Helper text directs the user to
     either the Manual tab (to enter rows from the transcription) or chat
     ("paste this and ask the advisor to structure it for you"). The Image
     tab no longer has a save action — `previewCount` for that tab is 0.
   - **Production caveat — free-tier OCR vs. training-data policy.** The
     `openrouter/free` default works only when the OpenRouter account has
     enabled "Free endpoints that may train on request data" under
     [Privacy settings](https://openrouter.ai/settings/privacy). Free-tier
     vision providers monetize by training on submissions, so this is the
     deal. **Acceptable for personal/dev use; NOT acceptable for production
     deployments handling other users' portfolio screenshots** (which
     include account-identifying ticker/unit data). For prod:
     - Either pin a paid no-train vision model: `OCR_MODEL=anthropic/claude-haiku-4.5`
       (or similar — Anthropic, OpenAI, Google all guarantee no-train via
       OpenRouter when explicitly selected).
     - Or disable the Image tab when the privacy setting is restrictive
       (a future check could probe OpenRouter at boot and feature-flag the
       UI accordingly).
     - Or use a direct provider SDK (e.g. `@ai-sdk/anthropic`) bypassing
       OpenRouter entirely, with explicit `no-store` headers.
     The current code does not enforce this — it's an operator
     responsibility. Track as a hard requirement before any public
     deployment under [Phase 6](#phase-6--multi-user).
   - **Data hygiene / retention best practices.** Portfolio screenshots
     are sensitive (tickers + unit counts identify accounts and net
     worth). Industry baseline for this class of data:

     | Principle | Current state | Future requirement |
     | --- | --- | --- |
     | **Don't persist what you don't need** | ✅ Image bytes never touch disk or DB — buffer goes browser → POST → OpenRouter → GC. Browser `imgPreview` clears on sheet close. | Hold this invariant. If we ever add server-side image caching (for retry / advisor re-processing / audit), require TTL ≤ 24h and per-user encryption. |
     | **TTL anything that does persist** | ⚠️ OCR text in `chat_messages` persists indefinitely (manual thread-delete only). | Phase 6 `holding_proposals.source_text` should auto-purge when status moves to `accepted` / `rejected` + 7 days (audit window). Optional: thread-level TTL setting per user. |
     | **User-controlled deletion** | ✅ Thread-delete cascades to messages. | Phase 6: deleting a user's account cascades to ALL their data (holdings, plans, chat, proposals). Right-to-be-forgotten if EU users ever apply. |
     | **Encryption at rest** | ⚠️ SQLite is plaintext on disk. Disk-level encryption (LUKS / cloud-provider EBS encryption) is the operator's responsibility. | Document in [deploy.md](./docs/how-to/deploy.md) for any prod deploy. Application-level encryption of sensitive columns (units, avg_cost) is overkill at personal scale. |
     | **Encryption in transit** | ✅ HTTPS via Caddy in prod; localhost in dev. OpenRouter is TLS by default. | Hold. |
     | **No-train upstream providers** | ⚠️ Default `qianfan:free` is operator-verified no-train per OpenRouter (2026-05-23); re-verify before any public deploy. | Phase 6 acceptance: `OCR_MODEL` must be a paid no-train model in prod. |
     | **Audit metadata, not content** | ✅ Server logs `POST /api/import/image 200 in 8.7s` — no image bytes, no transcription text. | Hold. If we add structured audit logs later, log call counts / model / timestamp only — never the OCR text. |
     | **Defaults minimize exposure** | ✅ Opt-in upload (user has to pick a file). Free-tier-training requires the operator to explicitly toggle a privacy setting. | Hold. |

     Most of these are "ready today" for personal use; the action items
     all cluster around **Phase 6** (multi-user opens the door to other
     people's data → strict retention becomes required, not aspirational).
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
- **Training-data leakage via free-tier vision models**: the default
  `openrouter/free` router uses providers that train on submitted images.
  Portfolio screenshots include identifying ticker + unit data. Mitigation
  for prod: override `OCR_MODEL` with a paid no-train model (Anthropic /
  OpenAI / Google via OpenRouter), or disable the Image tab when the
  account has tight privacy settings. See production caveat above.

### Follow-up: advisor-assist OCR (depends on Phase 6 tool calls)

**Where we are today (post-2026-05-23 redesign):** `/api/import/image` returns
`{ text: string }` — pure transcription, no structuring. The UI displays the
transcription in a monospace block with a Copy button and a prompt:
*"Use the Manual tab to enter rows, or paste this into chat and ask the
advisor to structure it for you."* The **human bridges** OCR and the
advisor: they copy the text and either fill the Manual form themselves or
paste it into chat where the advisor reads it as plain text (no tools — the
advisor can talk about it but can't write holdings yet).

This works for users who can recognize their tickers in the transcription
and know their unit counts. It fails when (a) the OCR is dirty (typos in
ticker symbols, line breaks in the wrong places) and (b) the user can't
manually reconcile what they see.

**Advisor-assist turns the human bridge into an automated one. The raw
transcription is intermediate state — the user never sees it.** The Image
tab becomes a one-step upload that hands off to the advisor:

1. On upload, `/api/import/image` returns the transcription as today.
2. The Image tab does NOT render the raw text. Instead it auto-starts (or
   resumes) a chat thread with the transcription pre-loaded as a system
   message ("I just OCR'd this screenshot for the user — turn it into
   holdings rows. The user has NOT seen the raw OCR; show them only
   structured proposals.").
3. Advisor reasons over the text. Calls a new `propose_holding` tool for
   each row it can confidently identify; asks clarifying questions in chat
   for the rest ("I see what looks like `K-FIXED-A` but the units are
   smudged — any guess?").
4. Each `propose_holding` call renders as a card in the chat — structurally
   identical to the existing `propose_plan_edit` cards. Each card shows
   the proposed ticker / units / avgCost / quoteSource cleanly (no OCR
   typos, no stray line breaks).
5. User accepts/rejects each card. Accepted cards POST to `/api/holdings`.

Why hide the transcription: raw OCR is noisy (typos, weird whitespace,
mis-read currency symbols). Showing it to the user trades clarity for
transparency they don't need. If the advisor proposes the wrong ticker,
the user catches it on the card (they recognize their own holdings); if
they want to debug deeper, a "show what the OCR read" expand on the chat
turn is the escape hatch — but it's collapsed by default.

Why this split-labor architecture is right: vision models that can OCR
cheaply can't reliably do structured output (we proved this in the v1→v3
redesign). Reasoning models that can do structured output don't do OCR
cheaply. Splitting the labor — cheap vision for transcription, smarter
reasoning model for structuring + conversation — gets quality and cost
both right, AND keeps the transcription out of the user's face.

Shape mirrors Phase 2's plan-edit pattern. Schema addition:

```sql
CREATE TABLE holding_proposals (
  id           TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL REFERENCES chat_threads(id),
  bucket_id    TEXT REFERENCES buckets(id),
  draft        TEXT NOT NULL,           -- JSON: { ticker, englishName?, units?, avgCost?, quoteSource }
  rationale    TEXT,                    -- advisor's reasoning, shown on the card
  source_text  TEXT,                    -- the OCR transcription excerpt this draft came from (audit trail)
  status       TEXT NOT NULL,           -- "pending" | "accepted" | "rejected"
  created_at   TEXT NOT NULL,
  resolved_at  TEXT
);
```

(The exported `ProposedRow` type in `lib/portfolio/ocr.ts` is the contract
for `draft` — we kept it around after the v3 redesign specifically so this
follow-up can reuse the same shape.)

**Depends on:** Phase 6 tool-call surface being solid (chat tools that
mutate state, structured proposal cards). Don't start this before Phase 6's
`propose_plan_edit` lands — it's the same pattern and should reuse the same
infrastructure.

---

## Phase 5 — Long-term memory + chat archival

**Goal:** the chat advisor remembers what the user has told it across
sessions (preferences, risk tolerance, constraints), long sessions stay
affordable on OpenRouter, and the chat sidebar gives discrete sessions
real persistence + lifecycle.

> **Status:** 5a shipped 2026-05-23; 5b pending. Full design (schema, tool
> surface, injection format, session lifecycle, sidebar UX, design
> rationale) lives in **[docs/explanation/memory.md](./docs/explanation/memory.md)**.
> This roadmap entry covers phase scope, sequencing, and acceptance.

**Design summary** (see the feature doc for the full reasoning):

- **Discrete chat sessions + persistent memory across them** — not one
  infinite thread. Each session ends; durable facts survive in memory;
  next session starts fresh with memory loaded.
- **Visible memory.** Settings → Memory shows every entry with source,
  validity window, and delete. No opaque inference.
- **Bitemporal validity.** `valid_from` / `valid_until` columns. Updates
  add a new row + supersede; nothing is mutated in place. Borrowed from
  Zep's bitemporal model — two columns instead of a full graph.
- **Inject hot, recall cold.** Active preferences load into the system
  prompt at session start (frozen for the session — Hermes cache
  discipline). A `recall` tool covers the long tail; ships in 5b once
  there's a long tail to recall.

### 5a — Memory foundation (explicit save + injection + sidebar) — ✅ shipped 2026-05-23

Shipped:
- Bitemporal `user_preferences` schema + queries + 7 vitest cases
  (`c972543`).
- Four tools (`save_preference` / `update_preference` /
  `forget_preference` / `list_preferences`) + always-on system-prompt
  injection with frozen-snapshot cache discipline (`d7ce80c`).
- Settings → Memory section: active notes grouped by category +
  "Recently forgotten (30 days)" + restore; forget is reversible so no
  confirm dialog (`5f7f3d4`, `4d1eeab`).
- Chat sidebar: auto-titling (cheap `TITLE_MODEL`, default
  `openrouter/free`), soft-delete + 30-day trash + restore/purge,
  persistent "Advisor is AI and can make mistakes." disclaimer (`48791ac`).
- In-panel thread-list view swap on desktop/tablet (matches the right-rail
  panel pattern; mobile keeps its drawer) (`0d7f417`).
- Fail-safe for empty LLM turns: surface tool-result text, or a calm note
  + "Try again" button instead of a blank/scary message (`4d1eeab`,
  `bef8262`).

**5b is purely additive on this schema.** The provenance columns
(`source`, `source_session_id`, `source_turn_ids`, `confidence`) exist
from day one even though only 5b writes non-NULL values — no migration
between phases.

### 5b — Session lifecycle + real-time extraction + chat summarization

Adds the session state machine (`active` / `idle` / `archived`; deletion
orthogonal on `deletedAt`), **real-time session-close extraction** of durable
facts to `user_preferences` with `source='extracted'`, chat-history
summarization to keep long sessions affordable, a `recall_preferences` tool,
and sidebar FTS search.

> **Design revised 2026-05-23 (post-#1–#4).** The original plan extracted on a
> 7-day-idle *timer*. It now extracts on **real session close** (New Chat /
> thread switch / window `pagehide`), **incrementally** — only turns past a
> per-thread watermark (`extracted_through_id`, migration `0006`), with the
> running summary as context — so resumed chats never re-process old turns and
> cost stays flat. The timer job became a `closeStaleSessions` backstop for
> abandoned sessions. The archive *digest* idea was dropped (resume context is
> handled by the mid-chat summarizer). Substeps 6–7 below describe the original
> landings; this note supersedes their trigger/wiring. Full current behavior:
> [docs/explanation/memory.md](./docs/explanation/memory.md).

User-facing copy: **"Archived"** (state), **"Summarizing…"** (in-progress),
**"notes"** (extracted preferences), **"Advisor"** (never "agent" or "bot"
in product copy). Persistent disclaimer under the chat input: *"Advisor
is AI and can make mistakes."* See feature doc for the full vocabulary
table.

### 5c+ — Recall depth + offline consolidation

Vector recall over archived sessions, cross-session @-references,
offline consolidation (dedup / supersede / decay). Gated on having
enough archived-session data to need any of it.

### Implementation order

1. **5a schema + queries** — `user_preferences` table, Drizzle migration,
   bitemporal helpers (active-filter).
2. **5a tool definitions** — four tools in the chat tools surface.
   Substring matching for `update` / `forget`.
3. **5a system-message injection** — load active rows at session start,
   render compact markdown, deterministic ordering, frozen for session.
4. **5a Settings → Memory page** — grouped by category, supersession
   indicator, per-row delete (soft → 30-day trash).
5. **5a chat sidebar** — Today/Yesterday/Previous-N-days grouping,
   auto-titling via a cheap OpenRouter model (DeepSeek/Qwen-class —
   *not* Claude/GPT for this), kebab actions, keyboard shortcuts.
6. **5b session lifecycle** — ✅ **shipped 2026-05-23** — state machine
   (`active` / `idle` / `archived`, default `active`; deletion stays on
   `deletedAt`) + `archivedAt` column (migration `0004_swift_hobgoblin`),
   lifecycle queries (`markIdle` / `archiveThread` / `listByStatus` /
   `findIdleThreads`) in `lib/db/queries/chat.ts`, and an idempotent
   7-day idle-archive job skeleton (later renamed
   `lib/jobs/close-stale-sessions.ts` and repurposed as the backstop — see the
   revision note above). Summarization + fact-extraction deferred to #2/#3.
7. **5b archive-time extractor** — ✅ **shipped 2026-05-23** —
   `lib/memory/extract.ts`: cheap-model (`resolveExtractorProvider`,
   `EXTRACT_MODEL` → `TITLE_MODEL` → `openrouter/free`) summarize + durable-
   fact pass over an idle session, writing `source='extracted'` rows with
   `confidence` + provenance (`sourceSessionId` / `sourceTurnIds`). Wired into
   the archive job from substep 6 (runs before the archive transition;
   best-effort — never blocks archival). Guards: injected memory is stripped
   from the extraction input (`stripInjectedMemory`, recursive-pollution
   guard), low-confidence rows (`confidence < 0.7`) are recall-only — excluded
   from the injected block via `INJECT_CONFIDENCE_THRESHOLD`; near-noise
   (`< 0.3`) dropped. The job returns per-session `notices` (summary +
   saved-count) for a future toast/digest surface.
8. **5b chat summarization** — ✅ **shipped 2026-05-23** —
   `lib/ai/summarize.ts`: `compressContext()` estimates input tokens with a
   documented chars/4 heuristic (no tokenizer dep), and once the assembled
   model input crosses ~80% of the context budget
   (`DEFAULT_CONTEXT_BUDGET_TOKENS`, `SUMMARIZE_THRESHOLD`) folds the older
   turns into one cheap-model summary (`resolveExtractorProvider` —
   `EXTRACT_MODEL` → `TITLE_MODEL` → `openrouter/free`) and keeps the last
   `RECENT_MESSAGES_KEPT` turns verbatim. The compression applies to the
   **model input view only** — wired into `app/api/chat/route.ts` (both owner
   and demo paths). Best-effort: a summarizer failure leaves the input
   uncompressed (never drops turns). Migration-free persistence — one
   `role='summary'` row per thread via `upsertSummary()` (free-TEXT role;
   excluded from display in `listMessages` + from FTS search); the persisted
   conversation is never deleted. Banner-suggested, not silent: the route sets
   an `x-context-summarized` header and `ChatScreen` shows a dismissible
   "earlier turns are summarized — start a new chat" banner. Tests
   (`lib/ai/summarize.test.ts`, `lib/db/queries/chat.summary.test.ts`, model
   mocked) cover the threshold trigger, recent-tail preservation, the
   <2× input-token-cost property, and that the DB row count is unchanged while
   the input view compresses.
9. **5b recall + search** — ✅ **shipped 2026-05-23** — `recall_preferences`
   tool (5th memory tool; keyword match over ACTIVE rows, the cold-recall
   complement to always-on injection) in `lib/memory/tools.ts` backed by
   `recall()` in `lib/db/queries/preferences.ts`. Sidebar full-text search:
   external-content FTS5 table `chat_messages_fts` + 3 sync triggers
   (insert/update/delete) via migration `0005_chat_fts`, a `searchThreads()`
   query (`lib/db/queries/search.ts`; bm25-ranked message snippets + title
   LIKE, soft-deleted threads excluded), a `GET /api/chat/search` route, and
   a debounced search input in `ChatThreadList`.

### Acceptance criteria

**5a:**

- User: *"remember I'm targeting retirement at 50"* → model calls
  `save_preference` → next new chat shows the model knows.
- Settings → Memory lists active rows grouped by category, with per-row
  delete (→ 30-day trash + restore) and supersession indicator.
- The injected system-prompt block is byte-identical across turns 2..N
  of the same session (prefix-cache verified by logging hash).
- "Actually change that to age 55" triggers `update_preference`; old row
  shown as superseded.
- Demo path: preferences persist for the session and disappear with the
  per-session in-memory SQLite.

**5b:**

- Closing a session (New Chat / switch / window `pagehide`) runs extraction:
  marks the chat `idle`, writes 0–N extracted rows with provenance. Idempotent
  (once per close); a dirty-flag skips closes with no new turns.
- Resuming a chat reactivates it (`idle → active`); the next close extracts
  only the new turns (watermark + running-summary context), not the whole thread.
- `recall_preferences("retirement")` returns relevant active rows.
- A 50-turn session runs at <2× the input-token cost of a 5-turn one.
- Summarization never drops messages from the persisted DB — only from
  the model's input view.

### Risk

- **Auto-extraction quality** (5b). Cheap-model extraction will produce
  some false positives. Mitigation: confidence column, low-confidence
  rows are recall-only (not injected), Memory page shows source chat
  for audit, user can delete.
- **Recursive memory pollution** (5b). Extracting from a session whose
  context already contained injected memory feeds the model's own
  prior memory back into the next extraction pass. Mitigation:
  strip the injected memory block from the extraction input
  (Supermemory's pattern).
- **Preference rot.** Bitemporal columns mean stale facts stay
  retrievable but expire from injection — handles this by design. Memory
  page shows valid windows.
- **Privacy (Phase 6).** `user_id` filter is invariant on every memory
  query. Add a test that runs as user A and asserts zero rows for B.

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
- `OCR_MODEL` is set to a paid no-train vision model (e.g.
  `anthropic/claude-haiku-4.5`), NOT `openrouter/free`. Free-tier
  providers train on portfolio screenshots — incompatible with handling
  other users' data. See Phase 4 §Image OCR production caveat.

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

- **`NULL` user_id is fail-OPEN.** Scoping is `user_id = me OR user_id
  IS NULL`, so every user sees every `NULL`-owned row. `NULL` is
  overloaded to mean three things — a shared built-in, legacy
  pre-backfill data, and *"a code path forgot to stamp the owner"*. The
  third is a data-leak footgun: a new table, a missed `ownerId()` on an
  insert, or a query that bypasses `ownedBy()` silently exposes one
  user's data to everyone, fail-open rather than fail-closed. Harmless
  while there is a single real account, but **before opening public
  signup**, switch to default-deny (unowned = invisible) with an
  explicit `is_shared`/`built_in` flag for the genuinely-public rows, so
  "shared" and "unowned-by-accident" stop being indistinguishable.
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

### Before public launch — multi-tenant hardening

Context: the intended rollout is a **public link** (e.g. on a personal
site) shared with family/friends. That means *anyone* can reach the
signup page, so data isolation — not just cost — becomes load-bearing.
The cost/abuse side is already handled (free-tier model gating + daily
token cap + Turnstile bot gate + env-gated OAuth). Status of the
isolation/operability gaps — **both data-isolation blockers shipped
2026-05-24**:

1. **Fail-closed scoping — ✅ done (2026-05-24).** `ownedBy()` is now
   default-deny for logged-in users (`user_id = me`); the built-in model
   library opts in explicitly via an `alsoWhere` (`built_in = true`)
   predicate rather than a blanket `NULL` fallback. A second user can no
   longer see another's rows (tested).
   See [lib/db/queries/scope.ts](./lib/db/queries/scope.ts).
2. **Per-user `plans` — ✅ done (2026-05-24).** Migration `0008`
   (autoincrement `id` + UNIQUE on `user_id`); `getPlan`/`upsertPlan` are
   scoped per user, so a second user no longer overwrites the owner's
   plan. See [lib/db/queries/plan.ts](./lib/db/queries/plan.ts).
3. **Owner admin surface — ⬜ should-do (not built).** Replace manual
   `UPDATE account_tier …` SQL with a small owner-only page: list users,
   flip `free`↔`trusted`, optionally disable an account. No new realtime
   plumbing needed — tier is read per request (`getTier()` in the chat
   route), so a change applies on the user's **next request**.
4. **Default posture — ✅ at code level.** New signups provision `free`
   (own isolated data, free models only); the owner promotes
   family/friends to `trusted` — via the backfill script today, or the
   admin UI in (3). A "your account is pending an upgrade" affordance is
   the remaining nicety.

Realtime *collaborative* editing (multiple users editing one record
live) is explicitly **out of scope** — index investing is single-owner
and low-frequency; a sharing/roles model (`portfolio_members` with
owner/editor/viewer) is the ceiling, and only if a concrete shared
workflow appears (joint household portfolio, advisor↔client view).

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
   `PUBLIC_APP_URL`, `OPENROUTER_API_KEY`, `AI_MODELS`. **If exposing the
   Image OCR tab in prod, set `OCR_MODEL` to a paid no-train vision model
   (e.g. `anthropic/claude-haiku-4.5`)** — the `openrouter/free` default
   relies on providers that train on submissions, which is incompatible
   with handling other users' portfolio screenshots. See Phase 4 §Image
   OCR production caveat. Add Phase 6 vars (`OWNER_EMAIL`,
   `GOOGLE_CLIENT_ID` / `SECRET`, `GITHUB_CLIENT_ID` / `SECRET`,
   `TURNSTILE_SITE_KEY` / `SECRET_KEY`, `DAILY_TOKEN_BUDGET_FREE` /
   `_TRUSTED`) once multi-user lands.
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
| Env vars | [.env.example](.env.example) + [auth-and-providers.md](./docs/reference/auth-and-providers.md) + [deploy.md](./docs/how-to/deploy.md) + [AGENTS.md](./AGENTS.md) (env var table) |
| Auth or security posture | [SECURITY.md](./SECURITY.md) + [auth-and-providers.md](./docs/reference/auth-and-providers.md) |
| Deployment topology / systemd / Caddy | [deploy.md](./docs/how-to/deploy.md) |
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

1. `cd macrotide` and re-read this file. Also read
   [AGENTS.md](./AGENTS.md) for project conventions (git rules, secrets
   policy, browser tools, env-var reference).
2. **Where we are (2026-05-23):** Phase 1 / 2.5 / 2.6 shipped. Phase 3b
   mostly shipped (Thai SEC provider + holdings.quote_source + demo
   pre-seed; RSS news still pending). Phase 4 OCR shipped as pure
   transcription. Env-var docs centralized in AGENTS.md. **Phase 5a
   shipped** (long-term memory foundation + chat sidebar;
   [docs/explanation/memory.md](./docs/explanation/memory.md)); **Phase 5b
   pending**. Phase 6 untouched.
3. **What to pick next** (ranked by impact/effort, ready to dispatch as
   parallel worktree agents — see "Working in parallel" below):
   - **ANALYSIS chart series (DRIFT / GEO / SECTOR / CONTRIB)** —
     half-day, no AI dependency, concrete UI win. Currently mocked from
     `lib/static/analysis.ts`. nav_history is now available in demo so
     compute can be real. Touches PortfolioScreen + a new
     `lib/portfolio/analytics.ts` + `/api/analysis` route (replace the
     static-import path).
   - **Phase 5b** — ✅ **shipped 2026-05-23** (session lifecycle + real-time
     session-close extraction + summarization + recall + FTS). The only
     remaining piece is scheduling the `closeStaleSessions` backstop sweep,
     which is parked with the "scheduled jobs" phase (the primary close path
     is real-time and needs no job runner).
   - **Phase 6 (multi-user)** — multi-day, one-way door. Only start when
     committed to sharing with family/friends.
4. **Don't pick yet:**
   - Advisor-assist OCR — wait for Phase 6's `propose_plan_edit` tool to
     land; same pattern, should reuse infrastructure.
   - PerfChart library swap (visx) — wait until hover-to-inspect or
     brush-to-zoom is actually needed.

### Working in parallel (agent team approach)

When dispatching multiple tasks at once, prefer Claude's `Agent` tool with
`isolation: "worktree"` so each agent works on its own git worktree and
local branch. Write self-contained briefs that include: file paths to read,
acceptance criteria, what NOT to touch, and the conventions in
[AGENTS.md](./AGENTS.md). Best ROI when the tasks touch non-overlapping
files. Examples of independent pairs:

- ANALYSIS charts + Phase 5b chat summarization — different layers, no overlap.
- Manual-entry autocomplete + RSS news (Phase 3c) — different domains.

Don't parallelize work that touches the same files (e.g. two features both
editing `PortfolioScreen.tsx` or `lib/portfolio/adapter.ts`) — merge
conflict cost exceeds the parallelism gain.

After agents finish, the main agent reviews each diff and merges (rebase
preferred over merge per [AGENTS.md](./AGENTS.md) git rules — but never
rebase main itself).
