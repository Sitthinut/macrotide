# Macrotide documentation

> An open-source AI investment companion for Thai index investors. This folder
> is the map of everything written down about the project — for the people who
> use it, the people who build it, and the AI agents that help maintain it.

New here? Start with the **[Getting started tutorial](./tutorials/getting-started.md)**.
Want the 90-second pitch and quick start? See the **[root README](../README.md)**.
Are you an AI agent about to change code? Read **[AGENTS.md](../AGENTS.md)** first.

## How these docs are organized

The docs follow the [Diátaxis](https://diataxis.fr/) framework — four sections,
each answering a different question. Pick by what you're trying to do:

| If you want to… | Go to | Mode |
|---|---|---|
| **Learn the app by doing** (first run, demo, first portfolio) | [tutorials/](./tutorials) | Learning |
| **Get a specific task done** (run it locally, import a portfolio, deploy) | [how-to/](./how-to) | Task |
| **Look up a fact** (env vars, API routes, the data model) | [reference/](./reference) | Information |
| **Understand how & why it works** (architecture, design decisions) | [explanation/](./explanation) | Understanding |

Feature deep dives and the prior-art research behind them live under
**[explanation/](./explanation)** — the per-feature design in
[explanation/memory.md](./explanation/memory.md) and the survey it's based on in
[explanation/research/](./explanation/research).

> **For AI agents — progressive loading.** This file is the L0/L1 map: read it
> first, then open only the section index (each folder's `README.md`) you need,
> then the single doc within it. Files are kept small and single-purpose so you
> load just the context the task requires. A machine-readable entry point lives
> at [/llms.txt](../llms.txt).

## Everything, in one table

### Tutorials — learning by doing
| Doc | What it gives you |
|---|---|
| [getting-started.md](./tutorials/getting-started.md) | Clone → run → try the demo → add your first holding → chat with the Advisor |

### How-to — task recipes
| Doc | Use when |
|---|---|
| [local-development.md](./how-to/local-development.md) | Setting up a dev loop: env, scripts, seeding, tests, hooks |
| [import-a-portfolio.md](./how-to/import-a-portfolio.md) | Getting holdings in via Paste/CSV, image OCR, and editable table entry |
| [deploy.md](./how-to/deploy.md) | Putting it on a VM (Caddy + systemd) or a tailnet |

### Reference — look it up
| Doc | Contains |
|---|---|
| [configuration.md](./reference/configuration.md) | How configuration works; points to the canonical env-var table in AGENTS.md |
| [api.md](./reference/api.md) | Catalog of `app/api/*` route handlers |
| [data-model.md](./reference/data-model.md) | The SQLite tables and how they relate |
| [auth-and-providers.md](./reference/auth-and-providers.md) | Passkeys, OpenRouter, rate limits, where data lives |
| [Security policy](../SECURITY.md) | Threat model, reporting (lives at repo root) |

### Explanation — understand the why
| Doc | Explains |
|---|---|
| [architecture.md](./explanation/architecture.md) | The system shape, request lifecycle, and where everything lives |
| [design-principles.md](./explanation/design-principles.md) | Secure-by-default, the "Advisor" voice, single-owner → multi-user |
| [memory.md](./explanation/memory.md) | The long-term memory + chat-session design |
| [research/memory-systems.md](./explanation/research/memory-systems.md) | Prior-art survey behind the memory design |

### Project status & process (repo root)
| Doc | Role |
|---|---|
| [ROADMAP.md](../ROADMAP.md) | **The** source of truth for what's done / in progress / planned |
| [AGENTS.md](../AGENTS.md) | Rules + canonical env-var table for AI agents touching the code |

## Keeping these docs honest

Staleness is the #1 documentation failure mode. The conventions that fight it:

- **Single source of truth.** Each fact lives in exactly one place; everything
  else links to it. The env-var table lives in [AGENTS.md](../AGENTS.md); deploy
  steps in [deploy.md](./how-to/deploy.md); feature status in [ROADMAP.md](../ROADMAP.md).
  Docs here **link**, they don't copy.
- **Docs travel with code.** Update the doc in the same commit as the change.
- **Docs link to code paths** (`see lib/db/schema.ts`) so a moved file is an
  obvious review flag. Many source files reciprocate with `see docs/...`.
- **Last-updated stamps** appear on `explanation/` docs that can drift.
