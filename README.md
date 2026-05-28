# Macrotide

> An open-source AI investment companion for Thai index investors. Personal-use
> experiment.

[![CI](https://github.com/Sitthinut/macrotide/actions/workflows/ci.yml/badge.svg)](https://github.com/Sitthinut/macrotide/actions/workflows/ci.yml)

## Status

**Experimental — don't rely on it for real investment decisions.** The
8-screen UI (Portfolio, Markets, Explore, Advisor, Journal, Models, Connect, Settings) is
responsive across mobile / tablet / desktop with light/dark/system themes.

| Capability | Status |
| --- | --- |
| Persistence — SQLite + Drizzle, daily backups | ✅ Shipped |
| AI advisor — streaming chat, tool-calls, proposal cards, transparent health score, performance-vs-index + plan-anchored rebalancing guidance | ✅ Shipped |
| Passkey auth + isolated per-session demo mode | ✅ Shipped |
| Market data — real index levels (EODHD/FMP, with ETF-proxy + Yahoo fallback) + FX, Thai fund NAVs + history (Thai SEC), RSS news | ✅ Shipped |
| Instant fund finder — fuzzy + feeder-aware search, fee-annotated | ✅ Shipped |
| Portfolio import — CSV, manual autocomplete, image OCR with advisor handoff | ✅ Shipped |
| Long-term memory + chat archival — recall, FTS, session lifecycle | ✅ Shipped |
| Multi-user — per-user isolation, tiers/quotas, owner admin | 🟡 Code shipped; launch prep open |
| Benchmark comparison — "match or beat your index" (SET / S&P / Nasdaq / Nikkei) | ✅ Shipped; custom/goal-based benchmarks planned |
| Reliable index/FX source (Yahoo 429 fix) | ✅ Shipped |
| Richer AI — daily digest, AI-curated news brief, proactive review | ⬜ Planned |
| Data freshness — auto-refresh cadence per surface | ⬜ Planned |
| Scheduled NAV refresh | ⬜ Planned |

For what's next see [ROADMAP.md](./ROADMAP.md); for shipped detail see
[CHANGELOG.md](./CHANGELOG.md) and the **[docs/](./docs)** user + developer
guide.

## What it will do

- Hold your **mutual fund holdings** (Thai fund-supermarket account).
- **Visualize** allocation, fees, and NAV trends.
- Fetch a **market view** from free public sources (SET index, public fund
  pages).
- Let you **jot thoughts and chat with an AI** that has structured access to
  your portfolio, plan, and journal — including AI-proposed plan edits you
  accept or reject as cards.

## Tech stack

- [Next.js 16](https://nextjs.org/) (App Router) + React 19 + TypeScript
- Hand-rolled CSS — design tokens, light/dark/system themes (no Tailwind)
- Hand-rolled SVG charts
- [Biome](https://biomejs.dev/) for lint and format; [simple-git-hooks](https://github.com/toplenboren/simple-git-hooks)
  with [lint-staged](https://github.com/lint-staged/lint-staged) for pre-commit
- SQLite + [Drizzle ORM](https://orm.drizzle.team/) for persistence; per-session
  in-memory SQLite for the demo mode
- [Vercel AI SDK](https://sdk.vercel.ai/) via [OpenRouter](https://openrouter.ai/)
  for chat (one key, every major model)
- [better-auth](https://www.better-auth.com/) + passkeys for sign-in — see
  [auth-and-providers.md](./docs/reference/auth-and-providers.md), [SECURITY.md](./SECURITY.md), [deploy.md](./docs/how-to/deploy.md), [ROADMAP.md](./ROADMAP.md), [AGENTS.md](./AGENTS.md)

## Quick start

```bash
git clone <repo-url> macrotide
cd macrotide
npm install
npm run dev
```

Open <http://localhost:3000>. A fresh boot lands on `/login`; click
**Try the demo** to spin up an isolated in-memory SQLite seeded with mock
data (capped at 10 chat turns). For solo localhost dev, copy `.env.example`
to `.env.local` and set `AUTH_DISABLED=1` to skip the login screen — see
[auth-and-providers.md](./docs/reference/auth-and-providers.md). Chat returns a friendly stub until you set
`OPENROUTER_API_KEY`.

Scripts:

```bash
npm run dev        # dev server (hot reload)
npm run build      # production build
npm run start      # serve production build
npm run lint       # Biome check
npm run format     # Biome check --write
npm run typecheck  # tsc --noEmit
```

## Project layout

```text
macrotide/
├── app/
│   ├── (auth)/login/        Passkey sign-in screen
│   ├── api/                 Route handlers: buckets, holdings, journal, plan,
│   │                        models, quotes, settings, chat (+threads),
│   │                        market, demo, auth/[...all], admin
│   ├── layout.tsx, page.tsx, error.tsx, globals.css
├── components/
│   ├── screens/             Portfolio, Markets, Advisor (chat), Journal,
│   │                        Models, Connect, Settings (Explore lives in FundSelect.tsx)
│   ├── App.tsx, ClientApp.tsx, AppPanels.tsx, charts.tsx, *Sheet.tsx, …
├── lib/
│   ├── ai/                  OpenRouter provider + chat plumbing
│   ├── api/                 Rate-limit + with-db helpers for route handlers
│   ├── auth/                better-auth singleton + session helpers
│   ├── db/                  Drizzle client, schema, migrations, queries,
│   │                        per-session demo SQLite, daily backup
│   ├── fetchers/            SWR fetchers (client-side data layer)
│   ├── market/              Yahoo client + cache + indices
│   ├── mock/                Seed data + demo seed (used by db:seed)
│   ├── portfolio/           Allocation/concentration analytics, plan parser,
│   │                        plan-edit helper
│   ├── static/              Editorial content (markets/learn/personalities)
│   │                        and placeholder analytics
│   ├── format.ts, useViewport.ts, useScrollHide.ts
├── data/                    SQLite + daily backups (gitignored)
├── tests/                   Vitest
├── docs/                    User + developer guide (Diátaxis)
│   ├── tutorials/           Learning by doing (getting-started)
│   ├── how-to/              Tasks (local-development, import, deploy)
│   ├── reference/           Lookup (configuration, auth-and-providers, api, data-model)
│   └── explanation/         Why (architecture, design-principles, memory + research/)
├── llms.txt                 Machine-readable docs map for AI agents
├── README.md, AGENTS.md, SECURITY.md, ROADMAP.md, LICENSE
```

Only convention-mandated files stay at the repo root (README, AGENTS, SECURITY,
ROADMAP, LICENSE); everything else navigable lives under `docs/`.

## Documentation

Full docs live in **[docs/](./docs)**, organized with the
[Diátaxis](https://diataxis.fr/) framework:

- **New here?** [docs/tutorials/getting-started.md](./docs/tutorials/getting-started.md)
- **Building on it?** [docs/how-to/local-development.md](./docs/how-to/local-development.md)
  and [docs/explanation/architecture.md](./docs/explanation/architecture.md)
- **Looking something up?** [docs/reference/](./docs/reference) (config, API, data model)
- **An AI agent?** Read [AGENTS.md](./AGENTS.md), then [llms.txt](./llms.txt) →
  [docs/README.md](./docs/README.md).

## Contributing

This is an experimental personal project. PRs and issues are welcome but
expect slow / opinionated responses. If you're picking up something from the
roadmap, open an issue first so we don't duplicate work.

## License

[MIT](./LICENSE)
