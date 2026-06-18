# Macrotide

![Macrotide — an honest mirror for your index portfolio. Mobile and desktop screenshots of the portfolio dashboard.](./app/opengraph-image.png)

[![CI](https://github.com/Sitthinut/macrotide/actions/workflows/ci.yml/badge.svg)](https://github.com/Sitthinut/macrotide/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Sitthinut/macrotide/actions/workflows/github-code-scanning/codeql/badge.svg)](https://github.com/Sitthinut/macrotide/security/code-scanning)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

_An open-source AI investment companion for Thai index investors._

Macrotide closes the gap between index investing's proven theory and how DIY
investors actually execute it. It pairs education, portfolio analysis, market
research, and low-fee Thai fund selection with an AI advisor grounded in your
real holdings.

> ⚠️ **Experimental** — a personal-use project, not investment advice.

## Features

A responsive app built around **five main tabs** — Portfolio, Markets, Explore,
Advisor, and Journal — across mobile / tablet / desktop with light/dark/system
themes. At its core: hold your Thai mutual-fund holdings,
visualize allocation, fees, and NAV trends, pull a live market view from free
public sources, and chat with an AI advisor grounded in your real portfolio,
plan, and journal — including plan edits it proposes as accept/reject cards.

**Portfolio, ledger & analytics**

- **Unified ledger** — your holdings are a projection of one buy/sell + balance ledger; full-screen History and per-fund Position pages, in-place edits, custom self-priced assets, and graceful handling of unknown cost basis
- **Performance** — headline total return on contributed capital, with a full breakdown: realized and unrealized gains, money-weighted return (XIRR) per-fund and whole-portfolio, cost-basis timeline, contributions and income
- **Wealth-over-time chart** — portfolio value vs. net invested over time, replayed from your ledger so it shows what you actually held (exited funds included)
- **Plain-language health checks** — allocation drift, blended fees, cash drag, and look-through diversification (underlying single-name concentration, feeder-aware); fee-creep alerts you can dismiss or snooze
- **Flexible import** — paste, a screenshot, CSV, or typed rows, all reviewed in one editable list before saving; symbol autocomplete; enter by units or baht value
- **Broker auto-sync** — connect a broker once and it imports your full order history and keeps it in sync, each account as its own portfolio
- **Plan & journal** — a markdown investment plan the Advisor proposes edits to, plus notes, decisions, questions, and a reading list

**AI Advisor**

- **Grounded streaming chat** — knows your real portfolio, plan, and journal; tool-calls, accept/reject proposal cards, performance-vs-index and plan-anchored rebalancing guidance
- **In-chat vision** — attach images for multi-image holdings reconciliation (snapshot vs transaction-history auto-detected) into an editable importer, plus chart / factsheet Q&A
- **Long-term memory + chat archival** — recall, full-text search, and session lifecycle with preference extraction; you correct the Advisor in words (no ratings bar) and it remembers, with every write shown inline and reversible
- **Built to be reliable** — empty-turn recovery, provider fallback, a configurable cheap-paid public tier with token / cost caps, and a committed eval harness in CI

**Funds & markets**

- **Fund finder & screener** — fuzzy, feeder-aware search over priceable **share classes** with per-class fee, tax wrapper, and 1-year return; screen by tracked index (S&P 500, SET50…) for the cheapest trackers; shows buyable funds by default while search finds any active fund you might hold; TER ranking
- **Fund detail** — per-share-class price and fund-size (AUM) history, holdings by asset type, and feeder look-through to underlying holdings
- **Market data** — live index levels (FMP / EODHD with ETF-proxy + Yahoo fallback) + FX, Thai fund NAVs and history (Thai SEC), and RSS news, over a resilient stale-on-error cache
- **Benchmarks & models** — match-or-beat the market on a total-return basis (global, US, regional, and Thai indices), and model portfolios you can browse, fork, and set as a target that drives drift + health checks

**Platform**

- **Sign-in** — passkeys + Google, with an isolated, ephemeral per-session demo mode
- **Multi-user** — per-user data isolation, tiers and quotas, owner admin
- **Storage** — a two-database SQLite split (precious `app.db` + regenerable `market.db`) on Drizzle, with daily backups
- **Scheduled jobs** — daily NAV freshness + all-funds NAV/AUM history pre-warm on systemd timers, plus a nightly SEC fund-data ELT pipeline with risk-spectrum asset classification

For what's next see the **[project board](https://github.com/users/Sitthinut/projects/2)**;
for shipped detail see [CHANGELOG.md](./CHANGELOG.md) and the **[docs/](./docs)**
user + developer guide.

## Tech stack

- [Next.js 16](https://nextjs.org/) (App Router) + React 19 + TypeScript
- Hand-rolled CSS — design tokens, light/dark/system themes (no Tailwind)
- Hand-rolled SVG sparklines + recharts interactive charts
- [Biome](https://biomejs.dev/) for lint and format; [simple-git-hooks](https://github.com/toplenboren/simple-git-hooks)
  with [lint-staged](https://github.com/lint-staged/lint-staged) for pre-commit
- SQLite + [Drizzle ORM](https://orm.drizzle.team/) for persistence; per-session
  in-memory SQLite for the demo mode
- [Vercel AI SDK](https://sdk.vercel.ai/) via [OpenRouter](https://openrouter.ai/)
  for chat (one key, every major model)
- [better-auth](https://www.better-auth.com/) + passkeys for sign-in — see
  [auth-and-providers.md](./docs/reference/auth-and-providers.md), [SECURITY.md](./SECURITY.md), [deploy.md](./docs/how-to/deploy.md), [AGENTS.md](./AGENTS.md)

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
│   ├── market/              Provider registry + cache + indices
│   ├── mock/                Seed data + demo seed (used by db:seed)
│   ├── portfolio/           Allocation/concentration analytics, plan parser,
│   │                        plan-edit helper
│   ├── static/              Editorial content (markets/learn/personalities)
│   │                        and placeholder analytics
│   ├── format.ts, useViewport.ts, useScrollHide.ts
├── packages/
│   └── connector-sdk/       @macrotide/connector-sdk — broker-agnostic
│                            connector contract + parser/collector builder
├── data/                    SQLite + daily backups (gitignored)
├── tests/                   Vitest
├── docs/                    User + developer guide (Diátaxis)
│   ├── tutorials/           Learning by doing (getting-started)
│   ├── how-to/              Tasks (local-development, import, deploy)
│   ├── reference/           Lookup (configuration, auth-and-providers, api, data-model, design-system)
│   └── explanation/         Why (architecture, design-principles, memory, decisions/ + research/)
├── llms.txt                 Machine-readable docs map for AI agents
├── README.md, AGENTS.md, SECURITY.md, LICENSE
```

Only convention-mandated files stay at the repo root (README, AGENTS, SECURITY,
LICENSE); everything else navigable lives under `docs/`.

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
[project board](https://github.com/users/Sitthinut/projects/2), comment on the
issue first so we don't duplicate work.

## License

[MIT](./LICENSE)
