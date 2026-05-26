# Roadmap

> **What's next — forward-looking intent only.** What already works is the
> [README status board](./README.md#status); shipped detail is in
> [CHANGELOG.md](./CHANGELOG.md). If a line here describes something already true
> in the running app, it belongs in one of those, not here.

**Vision.** An AI investment companion for Thai index investors that helps them
**at least match — ideally beat — their index**, by making the whole journey one
calm, transparent, **fee-aware** loop with an advisor that knows their actual
portfolio. The full positioning — north star, who it's for, the four-pillar
product loop (**Learn → Analyze → Research → Select**), the index-purist stance,
and how we'll know it's working — lives in
[docs/explanation/product-direction.md](./docs/explanation/product-direction.md).
Personal-use experiment, soft-public for family and friends.

The app is past its static-data prototype stage: persistence, AI chat with
advisor tool-calls, market data, portfolio import, long-term memory, and the
multi-user foundation have all shipped. What remains is finishing the
public-launch hardening and a short list of forward work, framed below as
**Now / Next / Later** and tagged by the product pillar each item serves.

**Where the loop stands today.** The app is **live in production**
(soft-public). *Analyze* is mostly shipped (honest portfolio view +
performance-vs-index). *Research* is a flat RSS feed with richer AI planned.
*Learn* is stub content. **Select's foundation shipped** — a SEC-sourced fund
catalog with fees and a `find_funds` advisor tool, so the advisor can now name
lower-fee funds. The frontier has moved from *"is there a fund universe?"* to
**fund-data depth**: per-fund performance/returns vs benchmark, asset
allocation, and actual holdings (incl. bond ISINs and feeder master funds), plus
the external enrichment that depth unlocks.

## Out of scope (until a real need appears)

The cheapest way to keep this project focused — what it deliberately does *not*
do:

- **Open SaaS / billing / self-serve upgrade / admin web UI beyond tier
  toggling** — public sign-up defaults to free-tier; tier promotion is owner-
  driven.
- **Horizontal scaling / multi-region** — single VM, single SQLite writer; the
  trigger to change is migrating to Turso/Postgres, not layering on SQLite.
- **Enterprise SSO (SAML/OIDC), org/team accounts, magic-link email,
  billing/paywall, Apple OAuth** — add any only if a real user needs it.
- **Realtime collaborative editing** — index investing is single-owner,
  low-frequency; a sharing/roles model (`portfolio_members` with
  owner/editor/viewer) is the ceiling, and only if a concrete shared workflow
  appears.
- **Mobile-native app / PWA** — desktop / mobile web only.
- **Aesthetic overhaul** — handled inline, not as a stage of its own.

## Now — finish the public launch

**Goal:** open the app to family/friends via a public link. Each account is
isolated; the owner's OpenRouter budget is protected by per-user token caps and
free-tier-only access for new accounts. No transactional email.

The multi-user machinery is built and on `main`: per-user scoping (migrations
`0007`/`0008`), env-gated Google/GitHub OAuth, quotas + tier gating, the
Turnstile sign-up gate (bypassed when unset), and the account page. What's left
is launch readiness.

**Multi-tenant hardening status** (the public link means *anyone* can reach
signup, so data isolation is load-bearing):

1. **Fail-closed scoping — ✅ done.** `ownedBy()` is default-deny for logged-in
   users; built-ins opt in explicitly. See
   [lib/db/queries/scope.ts](./lib/db/queries/scope.ts).
2. **Per-user `plans` — ✅ done.** Migration `0008`; `getPlan`/`upsertPlan`
   scoped per user. See [lib/db/queries/plan.ts](./lib/db/queries/plan.ts).
3. **Owner admin surface — ✅ done.** An owner-only page (list users, flip
   `free`↔`trusted`) replacing manual `UPDATE account_tier` SQL — gated on
   `OWNER_EMAIL` and enforced server-side on every request, with a self-demote
   guard. Tier is read per request, so a change applies on the user's **next
   request**.
4. **Default posture — ✅ at code level.** New signups get `free` (own isolated
   data, free models only); the owner promotes to `trusted`. A "your account is
   pending an upgrade" affordance is a remaining nicety.

**Prod-ready landing page** *(pillar: front door)*. Today's
[components/Landing.tsx](./components/Landing.tsx) is a minimal one-column pitch.
The public debut needs a landing page that actually sells the product:
the **current capabilities** (honest portfolio analysis, performance-vs-index,
portfolio-aware advisor, demo mode) and **where it's going** (the Learn → Analyze
→ Research → Select loop, fee-aware fund finder) framed to draw a Thai index
investor in — with clear "Get started" / "Explore the demo" CTAs and the
open-source / data-private / never-trades trust signals. The repo's docs
(README, this roadmap, [product-direction.md](./docs/explanation/product-direction.md))
are the source material a design pass reads from; keep them current so the page
stays truthful. The page must not overpromise — anything not yet shipped is
described as planned, not present.

**Deploy to prod — ✅ done** *(pillar: front door)*. Live in production via
**Docker Compose + Cloudflare Tunnel** (outbound-only, no inbound ports, origin
hidden), with off-site restic→B2 backups and a nightly
SEC catalog crawl; the runbook is in [deploy.md](./docs/how-to/deploy.md).
Update loop: on the box `git pull && docker compose up -d --build` (migrations
auto-apply); roll back by restoring the restic snapshot. SEC Open API confirmed
on the **current Developer Portal v2 keys**. Remaining launch nicety: cut the
first dated [CHANGELOG](./CHANGELOG.md) heading and set the legal-page env vars
before wider sharing.

**Locked invariants for launch** (keep them tested):

- The `free` tier can **never** resolve to a non-free model regardless of
  `AI_MODELS` env — a config slip otherwise burns the budget.
- Every app route returns 401 without a session and only that user's rows with
  one. A leak test runs as user A and asserts zero rows for B.
- `OPENROUTER_API_KEY` never appears in browser-visible payloads.
- `PUBLIC_APP_URL` is pinned in production — changing it breaks passkey `rpID`
  and OAuth callback URIs.

## Next — close the loop

Launch opens the door; Next is where the product earns its keep — finishing the
four-stage **Learn → Analyze → Research → Select** loop. *Analyze* is largely
done and the advisor is already portfolio-aware (`read_portfolio` /
`read_performance`); the headline work is the **Select** pillar — letting the
advisor and UI name the *specific, low-fee* funds to buy. Items are tagged by
pillar; one shared infra item unblocks several.

### Foundation: a scheduler + the daily jobs that ride it *(enabler)*

Several Next items need work to run **off a trigger, not a request**. Make the
scheduler decision once (in-process `node-cron`, a systemd timer hitting an
authed internal route, or external cron — weigh against the single-VM deploy in
[deploy.md](./docs/how-to/deploy.md)), then hang the jobs off it:

- **Daily fund-catalog refresh** — the dependency for the Select flagship below.
- **Scheduled NAV refresh** — proactively pull after the Thai SEC's 17:30
  Bangkok window so charts are fresh without a user trigger. The fetching
  already works ([provider](./lib/market/providers/sec-thailand.ts)); only the
  scheduling is missing.
- **`closeStaleSessions` safety sweep** (`npm run jobs:close-stale`) — its
  primary close path is real-time, so this is just a backstop.

### Select — fund-data depth on the shipped catalog *(flagship)*

The catalog + fee-aware finder **shipped**: a SEC-sourced fund table keyed by
`proj_id` with FundFactsheet fees, a `find_funds` advisor tool that returns the
lowest-fee funds for a target exposure (incl. feeder funds for S&P 500 / global),
and a Select surface. The frontier moved from *"is there a universe?"* to
**how deep is each fund's data** — enrich every fund, all from SEC v2 on the
current key (exact endpoints/schemas catalogued in
[sec-open-data-api-spec](https://github.com/Sitthinut/sec-open-data-api-spec)):

- **Performance & risk** — per-fund + benchmark volatility and returns
  (3m–since-inception) from `factsheet/performance` (already fetched; only
  volatility was being read), plus the benchmark name from
  `factsheet/benchmarks`. Lets the finder rank on risk-adjusted terms, not fee
  alone.
- **Composition** — `factsheet/asset-allocation` buckets,
  `factsheet/top5-holdings`, and the full quarterly portfolio
  (`outstanding/portfolio`, with `isin_code` / issuer / %NAV). Surfaces what a
  fund actually holds; for feeder funds it names the master fund.
- **Fee-creep flag in Analyze** — surface when a held fund has a materially
  cheaper equivalent for the same exposure (rides the catalog).

Schema + ingestion for the depth data is **in progress**, gated behind
default-off env flags so the nightly crawl opts in deliberately (the full
portfolio roughly doubles crawl API calls → favour a weekly cadence).

### Select / Analyze — external enrichment *(free sources only)*

Depth SEC doesn't cover, achievable on **free / free-signup** sources (no paid
APIs):

- **Feeder look-through** *(feasible-free)* — given the master fund SEC names
  (e.g. iShares MSCI ACWI), pull its underlying holdings from the issuer's free
  public holdings CSV (iShares/Vanguard, via browser headers).
- **Tracking error vs benchmark** *(mostly feasible)* — fund-vs-benchmark
  return/vol come from SEC; a true tracking error needs the benchmark *index*
  series: SET TRI from SET's free XLS export (monitor freshness), global via the
  tracking ETF's adjusted close as a proxy.
- **Thai bond analytics** *(free-but-limited)* — enrich each bond holding's ISIN
  (from `outstanding/portfolio`) with maturity / credit rating / the gov yield
  curve from ThaiBMA's free public pages (HTML scrape — fragile; no free REST).
  Best value/effort: the free yield curve + per-ISIN rating/maturity; skip
  computed duration/YTM unless the scraping upkeep earns its keep.

### Select — sample & model-portfolio explorer

Let users **explore curated sample portfolios from multiple sources** (classic
lazy / all-weather / Thai-blend allocations) and clone one into their plan as a
target. The [`model_portfolios`](./lib/db/schema.ts) table already exists —
extend it with a small curated set. Pairs naturally with the fund finder: pick a
model, then fill each sleeve with the lowest-fee fund.

### Analyze — portfolio simulation / backtest

*"What if I held this mix?"* Backtest a target or proposed allocation against the
benchmarks over history, reusing the existing NAV/series
([lib/db/queries/series.ts](./lib/db/queries/series.ts)) and aligned-benchmark
infra. Read-only and educational — it informs Select decisions ("this cheaper
mix would have tracked your index just as closely") without ever implying a
prediction. High wow-factor on shipped foundations.

### Research — richer AI (not just chat)

Chat is the advisor's first surface, not its limit:

- **AI market digest — "Today, in your words."** A short, plain-language read of
  the day, grounded in the user's *actual* holdings + live index/NAV data — not
  a generic recap. Generated on demand (and later off the scheduled refresh).
- **AI-curated news brief.** Today's Markets feed ("From the long-term investing
  desk") is a flat RSS list. Turn it into a synthesized daily brief: cluster the
  day's items into a few short stories, each with a one-line "why it matters for
  a long-term index investor" and 2–4 curated links (original reporting first,
  then corroboration) instead of one headline per row.
- **Proactive portfolio review.** A periodic AI assessment — "what changed since
  last time, and does it need action?" — surfaced without the user asking:
  drift, fee creep, concentration, cash drag, rebalance nudges.
- **Index-purist single-name handling.** When asked about a hot stock/theme,
  the advisor reframes to the index plan and offers the closest low-fee thematic
  fund (needs the catalog's categories). See the stance in
  [product-direction.md](./docs/explanation/product-direction.md#index-purist-stance).
- **Agentic-turn reliability.** Pinning demo/free chat to `openrouter/free` for a
  5-step tool-calling task yields frequent empty / early-stop turns (a tool read
  with no follow-up prose or `propose_*` call → the "I didn't have a reply" UI
  fallback). Use a stronger small model for tool-calling chat, and/or persist and
  surface tool-only steps instead of dropping them. (Model logging now shipped —
  each assistant message records the model OpenRouter actually routed to — so
  this can be diagnosed against real data before picking a fix.)

### Analyze — benchmarks that are the user's own

The overlay now renders with **real, aligned** index series (SET / S&P 500 /
Nasdaq / Nikkei) and the advisor reasons about returns vs them — see the
changelog. What's left is making the benchmark genuinely *theirs*:

- **Editable / goal-based.** Beyond the preset index list, let the user pick or
  add the benchmark(s) that match their goal — their own SET index fund, a
  global index, or a blend — and persist the choice. The benchmark should be the
  one they're actually trying to match or beat, not only a preset.

### Foundation — data freshness & a durable index source

Two related data-quality gaps, separate from the scheduler above:

- **Auto-refresh cadence.** The dashboard is fetch-on-mount today: the SWR layer
  ([lib/fetchers/swr.ts](./lib/fetchers/swr.ts)) runs with defaults — revalidate
  on focus/reconnect, **no polling** — so an open screen never updates on its
  own. The 5-min quote TTL is dead code (`void QUOTE_TTL_MS` in
  [lib/market/cache.ts](./lib/market/cache.ts)); quote freshness rides the 24h
  history TTL, so intraday index moves can be up to a day stale on a warm cache.
  Decide a per-surface cadence (indices/FX ~1 min in market hours, news
  ~15–30 min, NAVs daily after the SEC window), wire `refreshInterval` where it
  earns its keep, and fix the quote TTL.
- **Durable index/FX source (Yahoo 429s).** Indices + FX come from Yahoo's
  unauthenticated chart endpoint, which rate-limits server-side requests (HTTP
  429), often blanket-blocking a deploy's IP. Mitigated so far (stale-on-error
  fallback, per-symbol backoff, warmed demo cache), but a cold start or a
  persistently-blocked IP still shows "Market data is unavailable." Options: a
  keyed provider with a real free tier (Alpha Vantage / Twelve Data / Finnhub)
  behind the existing `Provider` registry; Yahoo with proper cookie+crumb auth;
  or lean on the scheduled refresh to populate the cache off one well-spaced job.
  Thai fund NAVs already come from the SEC Open API (reliable) — this is only the
  index/FX path.

### Learn — index education hub

Turn the stub reading list ([lib/static/learn.ts](./lib/static/learn.ts)) into a
real, advisor-connected **Learn → Analyze → Research → Select** path: short
evidence-based reads (why index, why fees compound, how/when to rebalance, what
SSF/RMF/Thai ESG buy you), with the advisor able to teach in-context
("explain this number", "why does my fee matter?"). Lower urgency than the data
infra, but it's the on-ramp for the curious-beginner persona and the connective
tissue of the loop.

## Later — parked until a real need

Deliberate "laters," revisited on real need rather than on a schedule:

- **Google + GitHub OAuth sign-in** — passkey-only login covers launch; social
  SSO is a convenience add. The code path is env-gated and already merged; flip
  it on by registering the OAuth apps + setting the client vars when a real user
  wants it.
- **Scheduled jobs: weekly digest email + push notifications** — needs a
  scheduler/cron decision and (for digests) email transport, which the project
  deliberately avoids. Scheduled **NAV refresh** stays a Next item above (cheap,
  useful even solo).
- **Vector recall / offline memory consolidation** — current FTS-based recall
  is enough; revisit only if recall quality demands embeddings.
- **Broker scraping / unofficial APIs** — TOS + maintenance burden; only if a
  clear personal need emerges. No scraper lands without a discussion first.
- **DCA / contribution planner** *(Select)* — turn a target allocation into a
  concrete "buy ฿X of fund Y this month to stay on plan" schedule. A natural
  graduation of the fund finder; promote to Next once the catalog lands and the
  finder proves out.
- **Satellite polish — stocks & crypto** *(Analyze)* — holding individual
  stocks and crypto already works (Yahoo prices them; crypto maps to the
  `alternative` class). The polish, when wanted: a settable satellite cap with a
  drift/over-cap nudge and crypto's own slice in the allocation visuals. See the
  core-satellite frame in
  [product-direction.md](./docs/explanation/product-direction.md#what-you-can-hold-asset-classes-and-the-core-satellite-frame).
- **Thai tax-wrapper depth (SSF / RMF / Thai ESG)** *(Learn / Analyze)* — beyond
  bucketing, model the wrappers' rules (holding periods, annual contribution
  limits, deduction interplay) so the advisor can reason about them. Strong
  Thai-specific differentiator; gated on a real user need and careful "not tax
  advice" framing.

## Why this build order

Easiest → hardest, lowest risk → highest risk: **persistence** (mechanical,
unlocks everything) → **AI chat** (highest user value) → **market data**
(moderate plumbing) → **portfolio import** (hardest; unreliable data sources) →
**multi-user** (only needed before sharing a deployment). Aesthetics come last
and inline, not as a stage of their own — real data exposes the gaps worth
polishing.

Post-launch, the order follows the loop's weakest link: **Select** first (the
fund catalog + fee finder, which also forces the shared scheduler decision),
then **simulation** and **richer Research AI** on top of it, with **Learn**
threading through. The full rationale is in
[product-direction.md](./docs/explanation/product-direction.md).

## References

This doc is intent only. The neighbors that hold the rest:

- **Why we're building it / product direction** →
  [docs/explanation/product-direction.md](./docs/explanation/product-direction.md).
- **What works today** → [README status board](./README.md#status).
- **What shipped** → [CHANGELOG.md](./CHANGELOG.md) (by capability).
- **Why we picked what we picked** →
  [docs/explanation/decisions/](./docs/explanation/decisions/) (the
  settled-decisions log / ADRs).
- **How to run it** → [docs/how-to/deploy.md](./docs/how-to/deploy.md)
  (localhost + single-owner self-host runbook).
- **SEC Open Data API spec** (machine-readable mirror of every endpoint, param,
  and response schema) →
  [github.com/Sitthinut/sec-open-data-api-spec](https://github.com/Sitthinut/sec-open-data-api-spec).
- **Conventions for touching code** → [AGENTS.md](./AGENTS.md).
- **Feature designs** → `docs/` (Diátaxis: `tutorials/`, `how-to/`,
  `reference/`, `explanation/`), one file per feature.

## Doc stewardship

Stale docs are this project's #1 failure mode. Every code change that ships a
feature **must** include the matching doc update in the same commit.

| When you change… | Update… |
| --- | --- |
| Shipped a behavior change | [CHANGELOG.md](./CHANGELOG.md) `## [Unreleased]` (by capability) |
| A capability's shipped status | [README.md](./README.md#status) status board |
| Planned, unbuilt work | [ROADMAP.md](./ROADMAP.md) Now / Next / Later |
| A settled technical decision | [docs/explanation/decisions/](./docs/explanation/decisions/) |
| Env vars | [.env.example](.env.example) + [auth-and-providers.md](./docs/reference/auth-and-providers.md) + [deploy.md](./docs/how-to/deploy.md) + [AGENTS.md](./AGENTS.md) env table |
| Auth or security posture | [SECURITY.md](./SECURITY.md) + [auth-and-providers.md](./docs/reference/auth-and-providers.md) |
| Deployment topology | [deploy.md](./docs/how-to/deploy.md) |
| Conventions an agent must know | [AGENTS.md](./AGENTS.md) |
| External data source (provider, API) | feature doc under `docs/` + [SECURITY.md](./SECURITY.md) if it touches auth |

A doc reference to a function, env var, or file path is a contract: when you
rename/move/delete it, `grep -rn "thing" *.md docs/` and fix the references.
