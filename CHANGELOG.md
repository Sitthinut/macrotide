# Changelog

All notable changes to Macrotide are recorded here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries describe
shipped **capability** (not phase numbers — those go stale). Forward-looking
plans live in [ROADMAP.md](./ROADMAP.md).

Macrotide has not cut a release yet, so everything to date sits under
`[Unreleased]` as **Added** — there's no prior released version to mark things
`Changed`/`Fixed`/`Removed` against. The first public launch will be the first
cut: this section is sliced into a dated/versioned heading and a fresh
`[Unreleased]` starts above it, at which point those categories come into play.

## [Unreleased]

### Added

- **Instant fund search** — the fund finder typeahead is backed by an in-memory
  MiniSearch index (`lib/search/fund-index.ts`): fuzzy + prefix matching, field
  boosting, and curated index-nickname synonyms. It folds each feeder fund's
  **master** fund name into the index, so a search for "S&P500" surfaces feeder
  funds like KKP US500-UH. Replaces the old `LIKE '%q%'` scan that couldn't use
  an index or match by master fund; lookups are sub-50ms.
- **Real index levels** — new EODHD and FMP market providers return the **actual**
  index level (S&P 500, Nasdaq-100, Dow, Nikkei, Thai SET) where a free real
  source exists, instead of an ETF proxy. Provider chain is FMP → EODHD → Twelve
  Data (ETF proxy) → Frankfurter (FX) → Yahoo, degrading gracefully to the prior
  proxy/Yahoo behaviour when keys are unset. MSCI ACWI stays an ETF proxy (no
  free real index) and gold stays XAU/USD. New env vars `EODHD_API_KEY` and
  `FMP_API_KEY` (both free-tier). This is the "reliable index/FX source (Yahoo
  429 fix)" the README/ROADMAP listed as planned — Yahoo hard-429s datacenter
  IPs and the keyed providers resolve it.

### Changed

- **Database split into app.db + market.db** — the single SQLite is split along a
  lifecycle boundary: **app.db** is the system of record (accounts, buckets,
  holdings, plans, journal, models, chat, preferences, user market indicators)
  and **market.db** holds regenerable data (fund catalog/fees/performance/
  portfolio/feeder + the NAV/quote cache). A two-handle `DbContext` routes queries
  by domain; no join crosses the boundary. better-auth uses app.db; backups cover
  app.db only (market.db is regenerable and excluded from restic). Demo sessions
  get an isolated in-memory app.db but share the real market.db read-write, like a
  real user — demo reads from and warms the same NAV/quote cache (market data is
  global, so demo cache fills just cut redundant upstream fetches). New env var
  `MARKET_DB_PATH` (default `data/market.db`, same `data/` volume); a one-time
  `scripts/split-db.ts` migrates an existing combined DB. Rationale: blast-radius
  isolation (the nightly SEC refresh can't endanger accounts), lean backups,
  credential-free dev clones, demo-with-real-data.
- **Denormalized `fund_catalog.current_ter`** — the finder now sorts and annotates
  TER from a cached column on `fund_catalog` (maintained by `upsertFundFees`; the
  source of truth stays `fund_fees`), dropping the per-fund fee-history query.
  Browse-all and search fell from seconds to ~tens of ms. Added composite
  `(proj_id, period)` performance/portfolio indexes.
- **Manage-indicators reorder** — drag-and-drop reorder on the current
  `@dnd-kit/react` (migrated off the legacy `@dnd-kit/core` line); tier labels
  removed.
- **Portfolios sidebar reorder** — drag-to-reorder the portfolio list, persisted
  via a new `buckets.position` column and `PATCH /api/portfolios/reorder`.
- **Navigation labels** — the **Funds** tab is now **Explore** (it's catalog
  discovery, not a holdings list) and the **Chat** tab is now **Advisor** (it's
  the AI investment advisor). Screen ids are unchanged, so routing is untouched.
- **UI state stores** *(internal)* — the Portfolios panel↔screen and Chat
  window-event buses were replaced by typed `useSyncExternalStore` stores
  (`lib/stores/portfolio-ui.ts`, `lib/stores/chat-ui.ts`).

### Fixed

- **Fund detail** — duplicate portfolio rows are collapsed by identity
  (ISIN, or issuer+description) into one expandable net row; fixed a fund-detail
  500 (a query routed to the wrong DB handle after the split).
- **Portfolios YTD delta** — corrected a YTD change that always rendered
  positive/green.
- **Build reliability** — DB migrations are skipped during `next build` (parallel
  build workers were racing `CREATE TABLE`); they run normally at server startup.
- **Mobile bottom nav overflow** — the floating tab bar's buttons were rigid
  (`flex: 0 0 76px`) and spilled past the right edge on phones narrower than
  ~392px. The bar now uses a deterministic width with equal-flex buttons
  (`flex: 1 1 0`), so the five tabs divide it evenly down to 320px.

- **Persistence layer** — SQLite + Drizzle (15 tables), daily rotating backups,
  full CRUD APIs, SWR fetchers; all seven screens read from the DB.
- **Passkey auth + demo mode** — better-auth + WebAuthn passkeys, secure-by-
  default gate (`AUTH_DISABLED=1` opt-out for local dev), per-session isolated
  in-memory demo databases routed via AsyncLocalStorage.
- **AI chat** — streaming `/api/chat` via the Vercel AI SDK + OpenRouter (one
  key, every major model), owner/demo provider routing, IP rate limit, security
  headers; chat history + thread-list sidebar with recency grouping and
  per-thread delete.
- **Advisor tool-calls** — read portfolio / **performance** / plan / journal,
  write journal, propose plan edit, propose holding; capped tool loop; per-user
  scoped. `read_performance` reports the portfolio's period return alongside the
  same-window SET + S&P 500 returns, so the advisor can answer "am I beating my
  index?" with real numbers. The advisor gives concrete, plan-anchored
  buy/sell/hold + rebalancing guidance (educational, with a standing disclaimer)
  and references only tickers its tools returned. **Proposal cards** (plan edits
  and holdings) that write through only on accept.
- **Portfolio analysis** — transparent 0–100 score (deterministic, from drift /
  fees / concentration / cash, with a per-component breakdown); the Plan &
  Health panel is driven by real signals (drift, blended TER, concentration,
  cash drag, rebalance hint).
- **Interactive charts** (recharts) with hover + tooltips, including a
  portfolio-vs-benchmark overlay (SET / S&P 500 / Nasdaq / Nikkei) drawn from
  real index series, aligned to the portfolio's dates and rebased to a common
  start.
- **Market data** — SET + global indices and FX (Yahoo); **Thai fund NAVs +
  NAV history** (Thai SEC Open API) behind a provider registry +
  `holdings.quote_source` taxonomy. Resilient to upstream rate-limits: a
  stale-on-error cache fallback and per-symbol backoff keep a warmed cache
  serving through Yahoo 429s, the Markets screen shows an honest "unavailable"
  state instead of fabricated numbers when nothing loads, and the demo cache is
  pre-warmed (indices + NAV history) so charts render instantly.
- **RSS news aggregator** — curated long-horizon editorial feeds on the markets
  screen (parallel fetch, dedupe, 30-min cache, partial-failure resilience);
  HTML entities in titles are decoded, including double-encoded ones.
- **Portfolio import** — CSV upload, manual-entry ticker autocomplete (seed of
  known Thai funds + global indices, merged with the user's holdings), and
  **image OCR** (statement screenshot → raw transcription via an OpenRouter
  vision model, free → paid fallback). The Image tab can hand the transcription
  to the advisor, which proposes reviewable holding rows you accept or dismiss.
- **Holding sources** — tag where each holding is held with a free-text source
  (suggestions from your past sources + common Thai fund platforms); rename a
  source across all your holdings from Settings → Sources.
- **Long-term memory** — bitemporal `user_preferences`, memory tools, always-on
  system-prompt injection, Settings → Memory, chat sidebar (auto-title, 30-day
  trash). Plus session lifecycle (active/idle/archived), real-time session-close
  extraction of durable facts (incremental, watermarked), chat summarization at
  ~80% context, `recall_preferences`, and sidebar full-text search (FTS5).
  Guide: [docs/explanation/memory.md](./docs/explanation/memory.md).
- **Multi-user with per-user data isolation** — `user_id` on app tables with
  **fail-closed scoping** (each account sees only its own rows; built-ins opt
  in explicitly), per-user investment plans, owner backfill from `OWNER_EMAIL`,
  `requireUser()` on API routes; holdings are scoped through their owning bucket
  (ownership validated on read + write).
- **Identity providers** — Google + GitHub OAuth (env-gated; boots passkey-only
  with nothing set), post-OAuth passkey-registration prompt.
- **Quotas + tier gating** — `free` (free-model router only) vs `trusted`
  (owner model chain), daily token cap, per-user usage logging, limit UI.
- **Owner admin** — an owner-only screen (gated on `OWNER_EMAIL`, enforced
  server-side on every request) to list users and flip account tiers
  `free`↔`trusted`, replacing hand-written SQL; guarded against self-demote.
- **Sign-up gate** — Cloudflare Turnstile (dev-bypass when unset), wired auth
  rate limit, and an inline consent notice ("By continuing, you agree…") at
  account creation. `/legal/terms` + `/legal/privacy` are operator-configurable
  (name / contact / jurisdiction via env; nothing operator-specific committed).
- **Account page** — single "Sign in" section with passkeys (revoke, with a
  last-passkey lockout guard) named from their AAGUIDs, linked OAuth providers,
  usage, and sign-out everywhere.
- **Public signed-out landing page** for the shared link, with CTAs to sign in
  or try the demo.
- **Tooling baseline** — Biome (lint + format), GitHub Actions CI, Dependabot,
  git pre-commit hooks, Node 24.
