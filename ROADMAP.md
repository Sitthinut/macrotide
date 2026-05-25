# Roadmap

> **What's next — forward-looking intent only.** What already works is the
> [README status board](./README.md#status); shipped detail is in
> [CHANGELOG.md](./CHANGELOG.md). If a line here describes something already true
> in the running app, it belongs in one of those, not here.

**Vision.** An AI investment companion for Thai index investors — hold your
mutual-fund holdings, see allocation/fees/NAV trends honestly, and chat with an
advisor that has structured, read-and-propose access to your portfolio, plan,
and journal. Personal-use experiment, soft-public for family and friends. The
advisor is the heart of the product — chat is its first surface, not its limit;
richer AI features (a grounded daily read, an AI-curated news brief, proactive
portfolio reviews) are where the value compounds. The core promise is simple:
help an index investor **at least match their index, ideally beat it.**

The app is past its static-data prototype stage: persistence, AI chat with
advisor tool-calls, market data, portfolio import, long-term memory, and the
multi-user foundation have all shipped. What remains is finishing the
public-launch hardening and a short list of forward work, framed below as
**Now / Next / Later**.

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

**Locked invariants for launch** (keep them tested):

- The `free` tier can **never** resolve to a non-free model regardless of
  `AI_MODELS` env — a config slip otherwise burns the budget.
- Every app route returns 401 without a session and only that user's rows with
  one. A leak test runs as user A and asserts zero rows for B.
- `OPENROUTER_API_KEY` never appears in browser-visible payloads.
- `PUBLIC_APP_URL` is pinned in production — changing it breaks passkey `rpID`
  and OAuth callback URIs.

## Next — depth that makes the advisor worth using

Launch opens the door; this is where the product earns its keep. An AI advisor
that does more than chat, and a portfolio view honest enough to tell you whether
you're matching or beating your index.

### Richer AI features (not just chat)

Chat is the advisor's first surface, not its limit. Build out:

- **AI market digest — "Today, in your words."** A short, plain-language read of
  the day, grounded in the user's *actual* holdings + live index/NAV data — not
  a generic market recap. Generated on demand (and later off the scheduled
  refresh). Replaces the removed hardcoded card. *(Moved up from the backlog —
  this is core, not parked.)*
- **AI-curated news brief.** Today's Markets feed ("From the long-term investing
  desk") is a flat RSS list. Turn it into a synthesized daily brief: cluster the
  day's items into a few short stories, each with a one-line "why it matters for
  a long-term index investor" and 2–4 curated links (original reporting first,
  then corroboration) instead of one headline per row.
- **Proactive portfolio review.** A periodic AI assessment — "what changed since
  last time, and does it need action?" — surfaced without the user asking:
  drift, fee creep, concentration, cash drag, rebalance nudges.
- **Agentic-turn reliability.** Pinning demo/free chat to `openrouter/free` for a
  5-step tool-calling task yields frequent empty / early-stop turns (a tool read
  with no follow-up prose or `propose_*` call → the "I didn't have a reply" UI
  fallback). Use a stronger small model for tool-calling chat, and/or persist and
  surface tool-only steps instead of dropping them. *(The `read_performance` tool,
  plan-anchored rebalancing guidance, and the anti-hallucination rule have
  shipped — see the changelog; this reliability item is what's left.)*

### Benchmarks that are the user's own

The overlay now renders with **real, aligned** index series (SET / S&P 500 /
Nasdaq / Nikkei) and the advisor reasons about returns vs them — see the
changelog. What's left is making the benchmark genuinely *theirs*:

- **Editable / goal-based.** Beyond the preset index list, let the user pick or
  add the benchmark(s) that match their goal — their own SET index fund, a
  global index, or a blend — and persist the choice. The benchmark should be
  the one they're actually trying to match or beat, not only a preset.

### Data freshness & auto-refresh

The dashboard is essentially fetch-on-mount today: the SWR layer
([lib/fetchers/swr.ts](./lib/fetchers/swr.ts)) runs with defaults — revalidate
on focus/reconnect, **no polling** — so an open screen never updates on its own.
And the 5-min quote TTL is dead code (`void QUOTE_TTL_MS` in
[lib/market/cache.ts](./lib/market/cache.ts)); quote freshness actually rides the
24h history TTL, so intraday index moves can be up to a day stale on a warm
cache. Decide a per-surface cadence (indices/FX ~1 min in market hours, news
~15–30 min, NAVs daily after the SEC window), wire `refreshInterval` where it
earns its keep, and fix the quote TTL. The scheduled NAV refresh below is the
server-side half of this.

### Durable market-data source (Yahoo 429s)

Indices + FX come from Yahoo's unauthenticated chart endpoint, which rate-
limits server-side requests (HTTP 429), often blanket-blocking a deploy's IP.
Mitigated so far — stale-on-error fallback, a per-symbol backoff, and a warmed
demo cache — so a warmed cache survives outages, but a cold start (or a
persistently-blocked IP) still shows "Market data is unavailable." Pick a more
durable path before relying on live indices in production. Options to weigh:

- A keyed provider with a real free tier (e.g. Alpha Vantage, Twelve Data,
  Finnhub) behind the existing `Provider` registry — most reliable, costs an
  API key + per-provider symbol mapping.
- Yahoo with proper cookie+crumb auth, or a more lenient endpoint — no key, but
  brittle and may still throttle.
- Lean on scheduled refresh (below) to populate the cache off one well-spaced
  job instead of per-request fetches, shrinking 429 exposure.

Thai fund NAVs already come from the SEC Open API (reliable) — this is only the
index/FX path.

### Scheduled NAV refresh

Today NAVs are fetched on-demand and cached (5-min quotes, 24h history). A
scheduled refresh would proactively pull after the Thai SEC's 17:30 Bangkok
window so charts are fresh without a user trigger. The fetching already works;
only the scheduling is missing. The `closeStaleSessions` memory backstop
(`npm run jobs:close-stale`) is the other job that wants a scheduler — its
primary close path is real-time, so this is just a safety sweep. Needs a
scheduler/cron decision. (Weekly digest email + push notifications →
[Later](#later--parked-until-a-real-need).)

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

## Why this build order

Easiest → hardest, lowest risk → highest risk: **persistence** (mechanical,
unlocks everything) → **AI chat** (highest user value) → **market data**
(moderate plumbing) → **portfolio import** (hardest; unreliable data sources) →
**multi-user** (only needed before sharing a deployment). Aesthetics come last
and inline, not as a stage of their own — real data exposes the gaps worth
polishing.

## References

This doc is intent only. The neighbours that hold the rest:

- **What works today** → [README status board](./README.md#status).
- **What shipped** → [CHANGELOG.md](./CHANGELOG.md) (by capability).
- **Why we picked what we picked** →
  [docs/explanation/decisions/](./docs/explanation/decisions/) (the
  settled-decisions log / ADRs).
- **How to run it** → [docs/how-to/deploy.md](./docs/how-to/deploy.md)
  (localhost + single-owner self-host runbook).
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
