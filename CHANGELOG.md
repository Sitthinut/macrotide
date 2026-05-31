# Changelog

All notable changes to Macrotide are recorded here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries describe
shipped **capability** (not phase numbers — those go stale). Forward-looking
plans live on the [GitHub Project board](https://github.com/users/Sitthinut/projects/2).

Macrotide has not cut a release yet, so everything to date sits under
`[Unreleased]` as **Added** — there's no prior released version to mark things
`Changed`/`Fixed`/`Removed` against. The first public launch will be the first
cut: this section is sliced into a dated/versioned heading and a fresh
`[Unreleased]` starts above it, at which point those categories come into play.

## [Unreleased]

### Added

- **Inference-strategy docs — how the Advisor stays smart/fast/token-efficient.**
  A new design doc ([inference-strategy.md](./docs/explanation/inference-strategy.md))
  records the cost/latency/quality decisions for the Advisor — model routing &
  tiers, prompt-cache strategy, reasoning-token policy (with a "when should the
  Advisor reason?" decision table), context loading, and tool-result shaping —
  the principle behind each lever. It's backed by two new fact-checked prior-art
  surveys:
  [llm-platform-primitives.md](./docs/explanation/research/llm-platform-primitives.md)
  (how Anthropic/OpenAI/Gemini/OpenRouter expose tool calling, system prompts,
  reasoning tokens, citations & structured output) and
  [context-and-caching.md](./docs/explanation/research/context-and-caching.md)
  (prompt-caching cost/latency math + context-window management / progressive
  loading). The existing context-engineering survey had its flagged-unverified
  claims (Anthropic metrics, Hermes internals, iteration caps, LangGraph
  specifics) re-checked against primary sources and reworded.

- **Context-aware Ask-Advisor handoff — fewer tool round-trips.** The
  Ask-Advisor buttons now hand the Advisor a small structured **context
  envelope** (the screen, the intent, the subject in focus, and the figures the
  screen already computed) alongside the visible prompt, instead of burying it
  all in a sentence. The two high-value dashboard findings — *Plan the rebalance*
  (carries the tracking gap + target) and the fee-creep *Ask advisor* (carries
  the held fund, its TER, the cheaper alternative + its TER) — let the Advisor
  answer from those facts without re-deriving them via `read_portfolio`; the fund
  and model-strategy buttons tag the subject. The envelope is injected as a
  per-turn message **after** the cached system/memory prefix (never into it), so
  it can't invalidate prompt caching, and it's defensively parsed server-side.
  Plain typed turns and open-ended prompts are unchanged (the field is additive).
  The envelope reserves an `image` slot as the future home for in-chat vision.

- **Free tier can run a cheap paid model, bounded by a daily cost cap.** The
  free-tier chat model is now its own operator knob (`FREE_TIER_MODEL`, default
  the zero-cost `openrouter/free`) — set it to a cheap paid model (e.g.
  `google/gemini-2.5-flash`) to lift answer quality without touching the owner
  chain. It reads its OWN var, never `AI_MODELS`, so the long-standing "a free
  user can't be widened to a paid model by an owner-chain slip" invariant holds
  by construction. Spend stays bounded by two pre-request caps: the always-on
  daily **token** cap and a new optional daily **cost** cap in cents
  (`DAILY_CENTS_BUDGET_FREE`/`_TRUSTED`) — the right bound for a paid model with
  asymmetric input/output pricing. Per-turn cost is estimated from a
  `MODEL_PRICES` table (USD/Mtok) keyed on the model OpenRouter actually served;
  free/unpriced models contribute zero, so the cap is a no-op until you opt in.
  Owner mode stays uncapped.

- **Reasoning disabled on the cost-sensitive paths.** Free-tier, demo, and the
  ancillary title/extract calls now send `reasoning: { effort: "none" }` to
  OpenRouter, so a reasoning-capable model the router lands on doesn't silently
  burn hidden chain-of-thought (billed at the output rate, and measured at 8–29s
  vs ~2s per turn) on a chat turn that doesn't need it. Owner and trusted tiers
  keep their model-default reasoning — selectively raising effort for genuinely
  analytical asks is a planned, intent-gated follow-up. Non-reasoning models
  ignore the flag, so it's a safe no-op for them.

- **Reliable Advisor replies — no more "I didn't have a reply."** Free-tier chat
  turns that read a tool but stopped before writing an answer — or that hit an
  upstream provider error mid-turn — now recover automatically: the Advisor
  re-runs the final answer step with the data it already gathered, or retries
  once on an error, so a tool-using question lands a real reply instead of a
  dead-end. The recovery is model-agnostic (it doesn't depend on any single free
  model behaving), and applies across demo, free, and owner chat.

- **Context-aware Advisor starter prompts.** The chat composer's suggestion
  chips now reflect the user's actual portfolio and the screen they're on
  instead of a fixed list — surfacing prompts about a concentrated top holding,
  a cash drag, drift from the selected target model, or a high blended fee, and
  biasing toward the active screen (Markets, Explore, Models, Journal,
  Portfolio). A fresh or empty portfolio gracefully falls back to evergreen
  learning prompts.

- **Add holdings from a screenshot — structured import.** The Add-holdings
  **Image** tab now reads one or more broker screenshots into an **editable
  review table** shared with Paste/CSV and manual table entry, instead of
  dumping raw transcription text. Most Thai broker apps show market value +
  allocation %, not units — so where a fund's NAV is on file the importer
  derives units (`value ÷ NAV`) and average cost, marks them estimated, and
  highlights rows that still need quantity (open the fund's detail view for
  exact figures). Upload several images and the rows merge. Powered by a vision
  model (`OCR_MODEL`, default `google/gemini-2.5-flash`), validated on real Thai
  statements for faithful ฿/decimal reading; the screenshot is read once and
  never stored.

- **Confirm-before-delete on destructive actions** — deleting a holding,
  portfolio, or custom model template, purging a chat thread, removing a passkey,
  or signing out everywhere now routes through a consistent confirmation dialog
  (replacing native `window.confirm` and one unguarded one-click delete), so no
  irreversible action happens on a single mis-tap. The reversible 30-day chat
  trash and an ordinary sign-out stay one-tap.
- **Legal links on the front door** — the landing footer now links the Terms of
  Service and Privacy Policy pages.
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
  429 fix)" the README listed as planned — Yahoo hard-429s datacenter
  IPs and the keyed providers resolve it.
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
  `MARKET_DB_PATH` (default `data/market.db`, same `data/` volume); the existing
  combined DB was migrated once into the split layout at rollout. Rationale: blast-radius
  isolation (the nightly SEC refresh can't endanger accounts), lean backups,
  credential-free dev clones, demo-with-real-data.
- **Denormalized `fund_catalog.current_ter`** — the finder sorts and annotates
  TER from a cached column on `fund_catalog` (maintained by `upsertFundFees`; the
  source of truth stays `fund_fees`), dropping the per-fund fee-history query.
  Browse-all and search are ~tens of ms. Composite `(proj_id, period)`
  performance/portfolio indexes round it out.
- **Drag-to-reorder** — **Manage Indicators** uses `@dnd-kit/react` (off the
  legacy `@dnd-kit/core` line); tier labels removed. The **Portfolios sidebar**
  reorders the portfolio list, persisted via a `buckets.position` column and
  `PATCH /api/portfolios/reorder`.
- **Navigation labels** — the **Funds** tab is **Explore** (catalog discovery,
  not a holdings list) and the **Chat** tab is **Advisor** (the AI investment
  advisor). Screen ids are unchanged, so routing is unaffected by the rename.
- **Login screen** — the sign-in screen matches the landing aesthetic: brand
  mark + wordmark (clickable home), pill buttons, and clearer copy (drops the
  "real DB" jargon; uses the **Advisor** / **Explore** names). A signed-in user
  hitting `/login` is redirected server-side rather than via a client-side
  bounce, so there's no flash of the login UI; the post-OAuth passkey prompt
  and the demo sign-in path are unaffected.
- **Fund detail dedupe** — duplicate portfolio rows are collapsed by identity
  (ISIN, or issuer + description) into one expandable net row.
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
- **Portfolio import** — Paste/CSV upload, editable table entry with symbol
  autocomplete (seed of known Thai funds + global indices, merged with the
  user's holdings), and **image OCR** (statement screenshot → structured rows via
  an OpenRouter vision model). The Add-holdings sheet validates rows before
  saving; quantity is required and average cost is optional.
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
  or try the demo. Real-app screenshots ride inside the iPhone bezel SVGs on
  the hero and Advisor sections (with a graceful fallback to the coded mocks);
  a "bigger canvas" section between the Advisor spotlight and the four-stage
  Loop shows the desktop screenshot inside a pure macOS-style window border —
  rounded rect, multi-layer shadow + hairline ring, image's natural aspect
  ratio drives the height.
- **Tooling baseline** — Biome (lint + format), GitHub Actions CI, Dependabot,
  git pre-commit hooks, Node 24.
