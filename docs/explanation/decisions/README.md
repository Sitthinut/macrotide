# Decisions

Settled technical decisions for Macrotide, kept so re-cloners and future-you
don't re-litigate them. This is the rationale log; forward-looking plans live on
the [GitHub Project board](https://github.com/users/Sitthinut/projects/2), shipped
history in [CHANGELOG.md](../../../CHANGELOG.md).

Lightweight by design — a table for the one-line picks, prose for the rules that
outlive any single decision.

## What goes here

Two questions, in order:

1. **Is it worth recording?** The litmus test: *will someone six months from now
   look at the codebase or setup, think "this is weird, why didn't they just do
   X," and need an answer to avoid undoing it?* If no — it's the obvious choice,
   or a code comment covers it — skip it. This log is for the non-obvious calls
   where the obvious-looking alternative was **deliberately rejected**.
2. **How heavy?** Default to a one-line row in [Picks](#picks). Reserve a
   numbered ADR file for a genuinely contentious decision that needs the full
   context/options/consequences treatment (settled-by-precedent ≠ ADR-worthy).

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
| Fund-data crawl | ELT — land verbatim SEC payloads in `sec_raw`, then derive the catalog with an API-free, re-runnable transform ([data-model.md](../../reference/data-model.md#market-data-marketdb--written-by-the-market-layer--the-sec-crawl)) | Inline ETL discards endpoints/fields we don't map at fetch time and needs an ~80-min re-crawl to change a derived column; ELT makes a fix a seconds-long transform re-run |
| Fund share classes | Parent catalog + per-class child table; browse by parent, price/hold by class — [ADR 0002](./0002-fund-share-class-model.md) | Parent-only can't price multi-class funds; classes-as-catalog-rows makes browse noisy + duplicates parent enrichment |
| Explore screener ordering | Browse = each class by its **own** TER (cheapest first; ties: size, then retail before restricted); search = name relevance, exact-ticker first — [ADR 0002 §D2](./0002-fund-share-class-model.md) | Ranking families by one representative class let a fee-waived sibling drag expensive classes into the top; TER-sorting a *search* buries the fund you named under a cheaper unrelated one |
| Asset-class classification | SEC factsheet `risk_spectrum` code (RS1/RS2 → `cash`, RS3/RS4 → `bond`, RS6/RS7 → `equity`, RS8 → `alternative`); `policy_desc` + the money-market name-match are the fallback for funds with no code or an ambiguous one (RS5, the complex RS8x) | `policy_desc` has no money-market value (the Cash filter returned nothing) and is coarse; the earlier name-match alone was fragile. An AIMC sub-style/region taxonomy is the planned richer layer (still no clean machine-readable source) |
| Positions vs. transactions | One event ledger is the source of truth; `holdings` is a derived projection — [ADR 0004](./0004-unified-ledger-positions-derived.md) (supersedes [0003](./0003-transaction-ledger-data-model.md), which shipped them as separate models); the user-facing model + worked examples live in [Balances and History](../balances-and-history.md) | Two hand-entered sources (snapshot + ledger) drift and need reconciling; deriving positions removes the whole class of disagreement |
| Balance (anchor) is opening-vs-restatement by **prior state**, not stored kind | The same `opening`/`snapshot` anchor reads as a starting balance on a fresh position and a restatement on an existing one — decided when the ledger is folded ([ADR 0004](./0004-unified-ledger-positions-derived.md)) | A stored "this is the opening" flag goes stale if you delete the first balance; deriving it self-heals, and a ledger of only balances still gets a real opening |
| A Balance contributes its **cost-basis delta** to net-invested | A later balance counts only the *change* in cost basis (units × avg cost) since the last one — money added between balances, not the whole value | Re-counting each balance's full value double-counts contributions on every restatement; a pure price move (cost basis unchanged) must add zero. Avg cost = what you paid; today's value comes from the live NAV |
| A value-stated Balance derives units from **NAV on its own date** | A Balance can state a ฿ value with no unit count (the Thai-app case); units = value ÷ NAV(the Balance's date) — divisor is always a *current* price, never average cost. Detail in [Balances and History](../balances-and-history.md) | Today's moving NAV makes a dated value's unit count drift from the date it was true; dividing value by average cost conflates current value with cost basis (different prices) and invents a wrong unit count |
| **Save only facts; derive at the fold** | A row stores only the money fact given — read `units`, a Balance's `value`, or a trade's `amount`; the missing unit count (a value-only Balance OR an amount-only trade) is derived from value/amount ÷ NAV(date) at the projection fold ([resolve-derived-units.ts](../../../lib/db/queries/resolve-derived-units.ts)), never frozen at save, so it self-corrects when that date's NAV lands or is corrected | Freezing a NAV-derived unit count into the precious ledger bakes in regenerable market data: if NAV(date) wasn't on file at save (or is later corrected), the stored units are silently wrong forever, and the money figure the user actually saw was never persisted. Balances and trades are symmetric — both store the fact, derive the estimate |
| Custom (no-feed) asset price | `quote_source: "manual"`, valued from the **latest `transactions.market_price`** for the ticker (a Balance's current price, or a trade's execution price); unknown typed symbols infer `manual` — [ADR 0004](./0004-unified-ledger-positions-derived.md) | A separate one-price-per-asset field duplicates state the ledger already holds; assuming the stock/ETF feed for an arbitrary symbol returns nothing and reads as a total loss |
| Value-over-time = ledger replay | The chart replays the ledger point-in-time (units 0 before a position's first event, exited positions still charted), prices pre-NAV-coverage history from the ledger's own trade prices, carries in-transit settlement cash with a 30-day expiry, and draws a contribution line from external flows — [ADR 0005](./0005-value-over-time-ledger-replay.md) | `current_units × NAV(date)` summed a variable basket (coverage changes read as value jumps) and back-projected today's position; clipping to common coverage shortens real history, flat-fill fabricates it, and matching buys-to-sells infers a cash balance you can just compute |
| Contribution line ≠ `reduceLots().netInvested` | The chart's "net invested" is cumulative *external* cash flow from the settlement-cash fold; `netInvested` (proceeds-based, for XIRR sign) stays XIRR-only — [ADR 0005](./0005-value-over-time-ledger-replay.md) | A sell reducing contribution by *proceeds* phantom-swings the line ±the gain on every fund switch, even though no external money moved |
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
