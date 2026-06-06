# AGENTS.md

Project-specific rules for AI agents working on this repo.

> **Documentation map.** This file is your rules. Reference detail — env vars,
> architecture, the data model, the API surface, feature deep dives — lives in
> [docs/](./docs), with [llms.txt](./llms.txt) as a machine-readable entry point.
> Load progressively: `llms.txt` → [docs/README.md](./docs/README.md) → the one
> section you need. What to update when you change things — and where a new doc
> belongs — is the next section.

## Sources of truth & what to update

[README.md](./README.md#status) holds the capability/status board (what works
today); [CHANGELOG.md](./CHANGELOG.md) holds shipped detail by capability; the
[GitHub Project board](https://github.com/users/Sitthinut/projects/2) tracks
forward-looking work (issues grouped by Priority). When you ship or change
anything user-visible:

1. Add a one-line entry under `## [Unreleased]` in [CHANGELOG.md](./CHANGELOG.md),
   described by capability — not "yesterday", not a phase number.
2. Flip the matching row in the [README.md](./README.md#status) status board if
   its status changed, and close the matching
   [board](https://github.com/users/Sitthinut/projects/2) issue if it was listed
   as planned.
3. If you change env vars, update [deploy.md](./docs/how-to/deploy.md),
   [auth-and-providers.md](./docs/reference/auth-and-providers.md), and `.env.example` together. Never one without the
   others.
4. If you change auth / security posture, update [SECURITY.md](./SECURITY.md).
5. If you add, move, rename, or repurpose a doc, update **two** indexes: its
   **folder `README.md`** (the authoritative, complete index for that section —
   subfolders like `decisions/` and `research/` keep their own) and its line in
   [llms.txt](./llms.txt) (the flat machine-readable map). The top-level
   [docs/README.md](./docs/README.md) is a section *map*, not a leaf inventory —
   touch it only when you add or remove a whole section.

Stale docs are the #1 failure mode here. After implementing, do a docs pass
before committing — treat docs as part of the change, not a follow-up. Keep docs
**timeless** — present-tense capability, no issue numbers or status tags; status
lives in the board, CHANGELOG, and README status board (the table below), not in
the prose.

| When you change… | Update… |
| --- | --- |
| Shipped a behavior change | [CHANGELOG.md](./CHANGELOG.md) `## [Unreleased]` (by capability) |
| A capability's shipped status | [README.md](./README.md#status) status board |
| Planned, unbuilt work | the [GitHub Project board](https://github.com/users/Sitthinut/projects/2) (an issue, labelled + prioritized) |
| Env vars | the canonical table in [configuration.md](./docs/reference/configuration.md#environment-variables) + [.env.example](.env.example) + [auth-and-providers.md](./docs/reference/auth-and-providers.md) + [deploy.md](./docs/how-to/deploy.md) |
| Deployment topology | [deploy.md](./docs/how-to/deploy.md) |
| Auth or security posture | [SECURITY.md](./SECURITY.md) + [auth-and-providers.md](./docs/reference/auth-and-providers.md) |
| External data source (provider, API) | feature doc under `docs/` + [SECURITY.md](./SECURITY.md) if it touches auth |
| A settled technical decision | [docs/explanation/decisions/](./docs/explanation/decisions/) — default to a one-line Picks-table row; reserve a numbered ADR file for a genuinely contentious decision that needs the full options/consequences treatment (settled-by-precedent ≠ ADR-worthy) |
| Product intent / scope | [product-direction.md](./docs/explanation/product-direction.md) |
| Conventions an agent must know | this file |
| Add / move / rename a doc | Place it in the right [Diátaxis](https://diataxis.fr/) quadrant — tutorials (learn) / how-to (task) / reference (look up) / explanation (why, incl. decisions) — per [docs/README.md § How these docs are organized](./docs/README.md#how-these-docs-are-organized), then update its **folder `README.md`** index + its [llms.txt](./llms.txt) line (touch [docs/README.md](./docs/README.md) itself only when adding/removing a whole section) |

### Project board conventions

The [board](https://github.com/users/Sitthinut/projects/2) holds the data — don't
restate the issue list, colors, or IDs here; they'd go stale. The conventions:

- **Priority** = tier: **P0** now (launch, small/high-trust, or visible fixes),
  **P1** next, **P2** later. Stay within P0 unless told otherwise.
- **Status** = `Backlog → Todo → In Progress → Done`. File new planned work in
  **Backlog**.
- **Labels** = one `area:*` + one type (`bug` / `enhancement` / `documentation`);
  `parked` = revisit only on a real need.
- **Lifecycle:** on "what's next", lead with Todo (by Priority) but scan all of
  Backlog first — surface anything relevant to the task or higher-impact than the
  Todo items. Move to In Progress on start. Move to Done when merged to `origin/main`, then
  close the issue and do the ship-docs pass above. A Status nobody moves is worse
  than none.

A doc reference to a function, env var, or file path is a contract: when you
rename/move/delete it, `grep -rn "thing" *.md docs/` and fix the references.

## Personal data — never commit

This is a personal investing app. Do **not** put any of the following in
committed code, fixtures, tests, or docs:

- Real Thai fund codes the owner actually holds (use generic placeholders like
  `EXAMPLE-FUND-A`).
- Broker / fund-house brand names beyond what's already in editorial content.
- Email addresses, account names, real portfolio sizes, real cost basis.
- Any third-party private-company product names where embedding their identity
  could imply endorsement or violate TOS (e.g., commercial fund supermarkets).
  Reference only public, official data sources (Thai SEC, Yahoo Finance,
  exchange-published indices).

Tests use synthetic data only. If you need a real fund code to test against,
ask the user — never invent one and commit it as if it were real.

## DB routing — read before touching a route handler

Two SQLite files split by lifecycle: **app.db** (precious system of record —
accounts, the `transactions` ledger + its derived `holdings` projection, plans,
chat; `getAppDb()`/`getDb()`) and **market.db**
(regenerable — catalog/fees + NAV/quote cache; `getMarketDb()`). No FK or join
crosses the boundary; a module needing both reads each handle and joins app-side.
Full model (schema split, demo routing, why): [architecture.md § Two databases](./docs/explanation/architecture.md#two-databases-split-by-lifecycle).

- **Every route handler that queries MUST run inside `withDb`** ([lib/api/with-db.ts](./lib/api/with-db.ts)) — it reads the `macrotide_demo` cookie and routes to the right app.db (owner singleton vs per-session demo). Skip it and demo writes leak into the owner DB.
- **`streamText`'s `onFinish` fires after `withDb` returns** — capture the context and re-enter with `runWithDbContext(ctx, …)`, or demo writes land in the owner DB. Canonical pattern: `app/api/chat/route.ts`.
- Queries are `import "server-only"` ([lib/db/queries/](./lib/db/queries)); never import one into a client component — go through a fetcher.
- **`holdings` is a DERIVED projection of the `transactions` ledger, not a thing you write directly** ([ADR 0004](./docs/explanation/decisions/0004-unified-ledger-positions-derived.md)). The ledger is the source of truth for positions; `holdings` carries the projected `units`/`avg_cost` plus user-editable instrument metadata, and is rebuilt after every ledger write. To add/edit/delete a position, write a ledger event — `createHoldingViaLedger`/`editHoldingViaLedger`/`deleteHoldingViaLedger` and `insertTransactions`/`updateTransaction`/`deleteTransaction` ([project-holdings.ts](./lib/db/queries/project-holdings.ts), [transactions.ts](./lib/db/queries/transactions.ts)) all rebuild the projection. Never `INSERT`/`UPDATE` `holdings.units`/`avg_cost` by hand — the next rebuild overwrites it.

## Demo mode

"Try the demo" gives a `macrotide_demo` cookie → a private in-memory app.db per
session; market.db is the shared real one. Full model:
[architecture.md § Owner vs demo databases](./docs/explanation/architecture.md#owner-vs-demo-databases).

- Demo state is ephemeral — **never persist it to disk.** 1h idle TTL, hard cap
  200 concurrent, swept every request; chat capped at 10 turns (defends the
  OpenRouter budget).
- **Test the demo path whenever you touch `/api/chat`, `/api/plan`, or any route
  that writes.**

## Where things live

Concept-to-code index: [architecture.md § Where it lives](./docs/explanation/architecture.md#where-it-lives).
The rules that prevent mistakes:

- **Components MUST NOT import from `@/lib/mock/data` or `@/lib/mock/*` seeds** —
  verify with `grep -rn 'from "@/lib/mock/data"' components/` (zero hits). Seeds
  are for `db:seed` / demo only.
- User state goes through [lib/db/queries/](./lib/db/queries) via `withDb` (never
  a raw handle in a route); pure helpers in [lib/portfolio/](./lib/portfolio) stay
  DB/network-free; editorial strings + placeholder analytics in [lib/static/](./lib/static).

## Provider routing via holdings.quote_source

Every holding's `quote_source` column (NOT NULL, default `"market"`) routes its
NAV/price fetch: `"thai_mutual_fund"` → Thai SEC Open API; `"market"` → the
index/FX/stock chain (FMP → EODHD → Twelve Data → Frankfurter → Yahoo, first that
returns data wins). The full chain, quotas, per-symbol mapping, and graceful
degradation: [auth-and-providers.md § Market data providers](./docs/reference/auth-and-providers.md).

- **The value names the asset class, not the provider** — `"thai_mutual_fund"`
  means the asset regardless of which API serves it. Swapping a provider changes
  only the registry map; holdings stay valid. Use asset-class names for new
  sources (`"crypto"`, `"bond"`, `"fx"`), never a provider name.
- The user-visible ticker stays bare (`K-FIXED-A`); routing lives in its own
  column so it can't leak into UI labels, search, or CSV rows. Constants + label
  map: `lib/market/sources.ts`.
- **Adding a provider:** add the source to `QUOTE_SOURCES` (`lib/market/sources.ts`),
  implement a `Provider` with `matches(source, ticker)`, register it ahead of Yahoo
  (`lib/market/registry.ts`), add a UI label in HoldingSheet.
- Cache keys in `fund_quotes`/`nav_history` are the combined `${source}:${ticker}`,
  so one table holds quotes for every source.

## Auth conventions

- `AUTH_DISABLED=1` opt-out for trusted local dev only. Default is
  auth-required. It routes to the **persistent owner `app.db`** (not demo's
  in-memory DB), so holdings/plans/journal save and survive restarts; only the
  username doesn't persist — there's no better-auth `user` row to store it on,
  so the UI shows the fallback label ("Macrotide").
- `AUTH_SECRET` is mandatory in production; throws on boot if unset.
- Multi-user mode adds a nullable `user_id` to app tables (in the app baseline +
  migration `0004`). A signed-in owner's rows are stamped with their id; demo and built-in rows
  stay `NULL` (shared). Pre-multi-user rows start `NULL`.
- `OWNER_EMAIL` — names the owner account. The
  [backfill script](./scripts/backfill-owner.ts) attaches those `NULL`-owned
  rows to it and grants `trusted`; at runtime [lib/auth/owner.ts](./lib/auth/owner.ts)
  uses it to identify the owner for the admin UI (fail-closed — unset → nobody
  is owner). **Keep it in the running app's env, not just for the one-off
  script.** Run the script once after migrating.

## Environment variables

The canonical table — every `process.env.*`, its default, the code that reads it,
and its behavior — lives in
[configuration.md § Environment variables](./docs/reference/configuration.md#environment-variables).
When you add/rename a var, update that table + [.env.example](.env.example) in the
same commit.

Two invariants protect cost/security — don't regress them:

- The `free` tier model chain derives ONLY from its own `FREE_TIER_MODEL` var
  (default `openrouter/free`) in code
  ([lib/ai/provider.ts](./lib/ai/provider.ts) `resolveTierProvider`), never from
  `AI_MODELS` — so an owner-chain change can't widen free access. Pointing free at
  a paid model is a deliberate `FREE_TIER_MODEL` change, bounded by the daily token
  cap + optional `DAILY_CENTS_BUDGET_*` cost cap.
- `AUTH_SECRET` is required in production (boot throws); `PUBLIC_APP_URL` is pinned
  in prod — changing it breaks existing passkeys.

## Build, lint, test

```bash
npm run dev        # hot reload at :3000
npm run build      # production build (typechecks everything)
npm run lint       # Biome check
npm run format     # Biome --write
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run smoke:sec -- <FUND-CODE>          # smoke-test Thai SEC provider (needs SEC_API_KEY)
```

Pre-commit hook (simple-git-hooks + lint-staged) runs Biome on staged files.
**Never** commit with `--no-verify` — if the hook fails, fix the issue.

GitHub Actions CI runs typecheck + lint + build. The build step needs
`AUTH_SECRET` injected (already wired in `.github/workflows/ci.yml`).

## Migrations (Drizzle)

- Schema lives in [lib/db/schema/](./lib/db/schema) — `app.ts` (app.db) +
  `market.ts` (market.db), re-exported from `index.ts`. Put a new table in the
  file matching its lifecycle (precious → app, regenerable → market).
- Generate migrations with `npm run db:generate` (runs both
  `db:generate:app` + `db:generate:market`). Each DB has its own config
  (`drizzle/config.{app,market}.ts`) and migration dir
  (`lib/db/migrations/{app,market}/`). Migrations are forward-only; in dev,
  prefer `db:drop:app`/`db:drop:market` + reseed over hand-editing.
  The FTS5 `chat_messages_fts` table (not expressible in drizzle) rides as a
  hand-written custom migration on the app baseline.
- Migrations run on boot in [lib/db/client.ts](./lib/db/client.ts) for both
  handles. Demo DBs replay the APP baseline only on session create (market is
  the shared real DB).
- Adding a column to an app table? Most app tables already carry a nullable
  `user_id` (app baseline + `0004`) for per-user scoping; design new ones the same way.
  (`0007` is the holdings→ledger backfill — see ADR 0004.)

## Product copy & vocabulary

These are durable rules for user-facing copy in macrotide. Apply them
when writing UI strings, toasts, banners, page titles, button labels, or
chat-system prompts — anywhere a user sees words.

**Voice:** formal and friendly. Plain English over jargon. No emojis in
product copy unless the user explicitly asks.

**The AI is "Advisor".** Never "agent", "bot", "assistant", or "AI" in
running copy. Page titles, system prompts, marketing pages all use
"Advisor". Internal/code identifiers (variable names, DB enum values
like `source = 'advisor_tool'`, log lines) follow the same convention.

**Persistent disclaimer.** Below the chat input on every session, a
single muted line:

> *Advisor is AI and can make mistakes.*

That exact phrasing — not paraphrased — is the project-wide AI-warning
copy. Reuse it verbatim anywhere else a similar disclaimer is needed.
Not dismissible; not a banner.

**Memory / chat-session vocabulary:** "Archived" (not "Compressed"/"Wrapped up"),
"Summarizing…" (not "Compressing…"), "notes" (not "facts"/"memories"), "Deleted
chats" (not "Trash"). Full table: [memory.md](./docs/explanation/memory.md).

**Timestamps:** store UTC, render in the user's IANA timezone. Timezone
itself is a `profile`-category preference in `user_preferences` (set
default from the browser; let the user override on the Settings page).

## When in doubt

- For "where do I put X?" — check the table above.
- For "is this in scope?" — check the
  [GitHub Project board](https://github.com/users/Sitthinut/projects/2)
  (Priority **P0** = now). Stay within P0 work; don't expand into P1/P2. File
  anything you notice as a new issue, or check the
  [Non-goals](./docs/explanation/product-direction.md#non-goals).
