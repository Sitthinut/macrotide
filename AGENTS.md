# AGENTS.md — macrotide

Project-specific rules for AI agents working on this repo. The workspace-level
[../AGENTS.md](../AGENTS.md) covers cross-cutting rules (git, secrets, browser
tools); this file covers things that aren't obvious from reading the code.

## Source of truth for "what's done"

[ROADMAP.md](./ROADMAP.md) is the single index of feature status. When you ship
or change anything user-visible:

1. Update [ROADMAP.md](./ROADMAP.md) — the "Phases at a glance" table and the
   relevant phase section. Use the commit hash, not "yesterday".
2. Update [README.md](./README.md) "Status" block if it mentions the area.
3. If you change env vars, update [DEPLOY.md](./DEPLOY.md),
   [AUTH.md](./AUTH.md), and `.env.example` together. Never one without the
   others.
4. If you change auth / security posture, update [SECURITY.md](./SECURITY.md).

Stale docs are the #1 failure mode here. After implementing, do a docs pass
before committing — treat docs as part of the change, not a follow-up.

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

## DB routing — read this before touching any route handler

Every API route that calls `getDb()` (which most queries do via
[lib/db/queries/](./lib/db/queries/)) MUST run inside `withDb`. The wrapper
reads the `macrotide_demo` cookie and opens an AsyncLocalStorage scope that
routes the query to the right SQLite (owner singleton vs per-session demo
in-memory).

```ts
// app/api/foo/route.ts
import { withDb } from "@/lib/api/with-db";
import { listSomething } from "@/lib/db/queries/something";

export async function GET() {
  return withDb(async () => {
    const rows = await listSomething();
    return Response.json(rows);
  });
}
```

### Streaming + callbacks — re-enter the context

`streamText`'s `onFinish` callback fires **after** `withDb` returns. You must
capture the context and re-enter it manually, or demo writes will land in the
owner DB. See `app/api/chat/route.ts` for the canonical pattern:

```ts
return withDb(async (ctx) => {
  const result = streamText({
    model,
    messages,
    onFinish: ({ text }) => {
      runWithDbContext(ctx, () => appendMessage(threadId, "assistant", text));
    },
  });
  return result.toUIMessageStreamResponse();
});
```

### Server-only

`better-sqlite3` is Node-native. Queries live in
[lib/db/queries/](./lib/db/queries/), gated by `import "server-only"`. Never
import a query from a client component — go through a fetcher.

## Demo mode

- Visitors who click "Try the demo" on `/login` get a `macrotide_demo` cookie.
- Each session gets a private in-memory SQLite seeded from
  [lib/mock/demo-seed.ts](./lib/mock/demo-seed.ts).
- 1h idle TTL, hard cap 200 concurrent. Sweep runs on every request.
- Chat is capped at 10 turns server-side (defends OpenRouter budget).
- Demo state is intentionally ephemeral — never persist demo data to disk.

Test the demo path whenever you touch `/api/chat`, `/api/plan`, or any route
that takes a write.

## Where things live (avoid common mistakes)

| Kind | Lives in | Notes |
| --- | --- | --- |
| Editorial content (markets explainers, learn articles, AI personalities) | [lib/static/](./lib/static/) | Code-resident strings; ship in the bundle. |
| Placeholder analytics until Phase 6 (ANALYSIS scores etc.) | [lib/static/analysis.ts](./lib/static/analysis.ts) | Returns nulls / "—". Components render placeholder text. |
| Pure helpers (plan-edit, plan-parser) | [lib/portfolio/](./lib/portfolio/) | Unit-testable; no DB / network. |
| User state (buckets, holdings, plan, journal, chat) | [lib/db/queries/](./lib/db/queries/) via `withDb` | Owner vs demo routed automatically. |
| Mock seeds | [lib/mock/seed.ts](./lib/mock/seed.ts), [lib/mock/demo-seed.ts](./lib/mock/demo-seed.ts) | NEVER imported by components. |
| Shared types | [lib/mock/types.ts](./lib/mock/types.ts) | Misnamed (cosmetic debt) — types, not mock. |

**Components MUST NOT import from `@/lib/mock/data`.** Verify with
`grep -rn 'from "@/lib/mock/data"' components/` — should return zero hits.

## Provider routing via holdings.quote_source

Every holding has a `quote_source` column (NOT NULL, default `"yahoo"`)
that the market registry uses to dispatch NAV / price fetches:

| `quote_source` | Provider | Ticker shape |
| --- | --- | --- |
| `"thai_mutual_fund"` | Thai SEC Open API | bare proj_abbr_name or share-class (`K-FIXED-A`, `HIDIV-D`) |
| `"yahoo"` | Yahoo Finance | bare/dotted/caret symbols (`^SET.BK`, `AAPL`, `PTT.BK`, `THB=X`) |

**The value names the asset class, not the provider.** `"thai_mutual_fund"`
means "Thai mutual fund regardless of which API serves it." If we ever swap
the underlying provider, only the registry's routing map changes — holdings
stay valid.

The user-visible ticker stays bare (`K-FIXED-A`, not `thfund:K-FIXED-A`).
Routing lives in a separate column so it doesn't leak into UI labels,
search input, or imported CSV rows. See `lib/market/sources.ts` for the
constants + UI label map.

When adding a new provider:

1. Add the new source value to `QUOTE_SOURCES` in `lib/market/sources.ts`
   (use the asset class name — `"crypto"`, `"bond"`, `"fx"`, never the
   provider's name).
2. Implement a Provider with `matches(source, ticker)` returning true for
   that source.
3. Register it ahead of Yahoo in `lib/market/registry.ts`.
4. Add a UI label for the type selector in HoldingSheet.

Internal cache keys in `fund_quotes.ticker` and `nav_history.ticker` are
the combined `${source}:${ticker}` so the same table can hold quotes for
different sources without a schema change.

## Auth conventions

- `AUTH_DISABLED=1` opt-out for trusted local dev only. Default is
  auth-required.
- `AUTH_SECRET` is mandatory in production; throws on boot if unset.
- Pre-Phase-6, every authenticated request operates on the single owner
  dataset. There is no `user_id` column on app tables yet.
- When Phase 6 ships, `OWNER_EMAIL` env var identifies the account that
  inherits all pre-migration data.

## Environment variables

| Var | Required | Notes |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | for real chat | Stub responses without it. |
| `AI_MODELS` | optional | Comma-separated fallback chain. Default `openrouter/auto`. |
| `DEMO_OPENROUTER_API_KEY` | optional | Demo traffic uses this if set, else falls back to free-tier router. |
| `AUTH_SECRET` | production | Required when `NODE_ENV=production`. |
| `AUTH_DISABLED` | dev convenience | Set to `1` to skip the login gate on localhost. |
| `PUBLIC_APP_URL` | production | Canonical URL; passkeys break if this changes. |
| `SEC_API_KEY` | quote_source=thai_mutual_fund | Thai SEC Open API subscription key (Primary or Secondary — both valid). One subscription covers all 6 product groups. Header: `Ocp-Apim-Subscription-Key`. |
| `OCR_MODEL` | optional | OpenRouter vision model used by the Image tab of the Add holdings sheet. Defaults to a `:free` tier model so this path never burns paid credits. |

Keep [.env.example](./.env.example), [AUTH.md](./AUTH.md), and
[DEPLOY.md](./DEPLOY.md) in sync when you add/rename variables.

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

- Schema lives in [lib/db/schema.ts](./lib/db/schema.ts).
- Generate migrations with `npm run db:generate`. Migrations are forward-only;
  in dev, prefer `drizzle-kit drop` + reseed over hand-editing past
  migrations.
- Migrations run on boot in [lib/db/client.ts](./lib/db/client.ts). Demo DBs
  replay the same migrations on session create.
- Adding a column to an app table? Remember Phase 6 will eventually add
  `user_id` to most of them; design with that in mind.

## When in doubt

- For "where do I put X?" — check the table above.
- For "is this in scope?" — check [ROADMAP.md](./ROADMAP.md) phase boundaries.
  Don't expand scope to cover the next phase; record what you noticed in the
  phase's "Risk" or "Out of scope" section.
- For "should I commit?" — only when the user has authorized. See workspace
  [../AGENTS.md](../AGENTS.md) for the git posture rule.
