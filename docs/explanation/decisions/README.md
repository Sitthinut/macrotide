# Decisions

Settled technical decisions for Macrotide, kept so re-cloners and future-you
don't re-litigate them. This is the rationale log; forward-looking plans live on
the [GitHub Project board](https://github.com/users/Sitthinut/projects/2), shipped
history in [CHANGELOG.md](../../../CHANGELOG.md).

Lightweight by design — a table for the one-line picks, prose for the rules that
outlive any single decision. A genuinely contentious decision can graduate to
its own numbered ADR file in this folder when it needs the full
context/options/consequences treatment.

## Picks

| Decision | Picked | Why not the alternative |
| --- | --- | --- |
| ORM | Drizzle | Prisma heavier; raw SQL loses types |
| Client data layer | SWR | React Query overkill at this scale |
| AI provider | Vercel AI SDK + OpenRouter | Direct Anthropic SDK locks to one provider |
| Chat model | `AI_MODELS` env (fallback chain), `openrouter/auto` default | Hardcoding one model = a one-string change every model bump |
| Auth | better-auth + passkey + (env-gated) Google | NextAuth heavier, Clerk/Auth0 vendor cost + lock-in |
| Signup + account linking | Emailless passkey accounts + OAuth as peer methods; link on demand, adopt the verified email on link — [ADR 0001](./0001-account-model-passkey-and-oauth.md) | Verifying a passkey-signup email needs a sender we don't run; keeping an email on passkey accounts leaves it squat-able |
| Email transport | **Skip entirely** — SSO + passkeys only | DNS + spam-folder UX is friction for a soft-public launch |
| Thai fund data | Thai SEC Open API — official, free w/ key | Scraping fund supermarkets = TOS/legal exposure |
| Fund share classes | Parent catalog + per-class child table; browse by parent, price/hold by class — [ADR 0002](./0002-fund-share-class-model.md) | Parent-only can't price multi-class funds; classes-as-catalog-rows makes browse noisy + duplicates parent enrichment |
| Positions vs. transactions | One event ledger is the source of truth; `holdings` is a derived projection — [ADR 0004](./0004-unified-ledger-positions-derived.md) (supersedes [0003](./0003-transaction-ledger-data-model.md), which shipped them as separate models) | Two hand-entered sources (snapshot + ledger) drift and need reconciling; deriving positions removes the whole class of disagreement |
| Sign-up bot defense | Cloudflare Turnstile | hCaptcha works too; Turnstile is already in the zone |
| Background job scheduling | systemd timers firing the `npm run jobs:*` scripts (topology in [deploy.md](../../how-to/deploy.md#scheduled-jobs-systemd-timers)) | In-process `node-cron` ties jobs to the web process + event loop; external cron needs an authed route surface |
| Storage scale | Single VM, single SQLite writer | Postgres/Turso only when a real scaling trigger appears |

## Durable rules

Rules that outlive any one decision above:

- **Portable Drizzle subset** — `mode: "json"` columns, `boolean()` (not raw
  0/1), ISO-8601 date strings, typed JSON access (no `json_extract` in app
  code), `index()` builder (not raw DDL), enums as TEXT validated at the Zod
  boundary. This keeps the SQLite → Turso / Postgres doors open.
- **No private / unofficial data sources** in code or docs — TOS/brand
  exposure for an experimental app. Gaps in the SEC API get raised as a
  discussion, never quietly scraped.
- **Sensitive-data hygiene** — don't persist what you don't need (image bytes
  never touch disk); TTL anything that does (OCR text in chat, future
  `holding_proposals.source_text`); account deletion must cascade to all a
  user's data; audit metadata (counts/model/timestamp), never content; rely on
  disk-level encryption (LUKS / provider EBS) documented in
  [deploy.md](../../how-to/deploy.md), not app-level column encryption.
- **`NULL` user_id was fail-open** (shared built-in vs. unowned-by-accident
  were indistinguishable). Resolved 2026-05-24 by making `ownedBy()`
  default-deny with explicit opt-in for genuinely-shared rows; keep it that way.
- **Periodic jobs = idempotent `npm run jobs:*` script + a thin systemd-timer
  wrapper** — never an in-process scheduler (it would tie job liveness to the web
  process + event loop). The script is the unit of testing and of manual runs;
  it's `DISABLE_JOBS=1`-aware and fails only on *systemic* error (tolerating a few
  transient upstream blips so a 99%-good crawl doesn't page). A job exposed both
  as a route and a timer shares one `lib/jobs/*` function so they can't drift.
  NAV **freshness** (held + indicators) and **coverage** (whole-catalog pre-warm)
  stay separate timers, not one flagged job. Roster + cadences:
  [deploy.md](../../how-to/deploy.md#scheduled-jobs-systemd-timers).
- **Portfolio health = named checks, not a headline grade.** No single 0–100
  "quality" score in the UI (a chase-able grade harms passive investors); lead
  with the plain-language headline + four named checks, keep the composite math
  internal for the Advisor. Diversification measures *underlying* concentration —
  single-fund size + look-through (single-name overlap as a lower bound +
  target-relative region), with independent flags / worst-status-wins and
  coverage-gated look-through that can only escalate concern, never certify
  health. Fund-count HHI dropped as the basis; component weights unchanged. Full
  rationale + sources: [portfolio-health.md](../portfolio-health.md).
