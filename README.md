# Macrotide

> An open-source AI investment companion for Thai index investors. Personal-use
> experiment.

## Status

**Experimental.** The UI is functionally complete — 7 screens (Portfolio,
Markets, Chat, Journal, Models, Connect, Settings), responsive across
mobile / tablet / desktop, with light/dark/system themes — but all data is
mock and there is no AI, persistence, or market integration yet.

Don't rely on it for real investment decisions. See [ROADMAP.md](./ROADMAP.md)
for what's coming.

## What it will do

- Hold your **mutual fund holdings** (Thai fund-supermarket account).
- **Visualize** allocation, fees, and NAV trends.
- Fetch a **market view** from free public sources (SET index, public fund
  pages).
- Let you **jot thoughts and chat with an AI** that has structured access to
  your portfolio, plan, and journal — including AI-proposed plan edits you
  accept or reject as cards.

## Tech stack

- [Next.js 15](https://nextjs.org/) (App Router) + React 19 + TypeScript 5
- Hand-rolled CSS — design tokens, light/dark/system themes (no Tailwind)
- Hand-rolled SVG charts
- [Biome](https://biomejs.dev/) for lint and format; [simple-git-hooks](https://github.com/toplenboren/simple-git-hooks)
  with [lint-staged](https://github.com/lint-staged/lint-staged) for pre-commit
- Planned: SQLite + [Drizzle ORM](https://orm.drizzle.team/) (Phase 1) and the
  [Vercel AI SDK](https://sdk.vercel.ai/) via [OpenRouter](https://openrouter.ai/)
  (Phase 2) — see [ROADMAP.md](./ROADMAP.md)

## Quick start

```bash
git clone <repo-url> macrotide
cd macrotide
npm install
npm run dev
```

Open <http://localhost:3000>. The app boots with static mock data — no API
keys or external services required.

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

```
macrotide/
├── app/              Next.js App Router (currently a single-page client app)
├── components/       Screens + UI primitives + chart components
├── lib/
│   ├── mock/        Mock data (will be replaced by a real DB in Phase 1)
│   ├── format.ts    THB / percent / number formatters
│   └── useViewport.ts
├── ROADMAP.md       What's coming next
└── README.md        You are here
```

## Contributing

This is an experimental personal project. PRs and issues are welcome but
expect slow / opinionated responses. If you're picking up Phase 1, 2, 3, or
4 from the roadmap, open an issue first so we don't duplicate work.

## License

[MIT](./LICENSE)
