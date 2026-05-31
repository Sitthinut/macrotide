# Design principles

*Last updated: 2026-05-24*

The durable ideas that shape decisions across Macrotide. Where a principle has
an operational home, this page explains the *why* and links to the canonical
rules rather than restating them.

## Secure by default

The safe configuration is the **default**; you opt *in* to riskier behavior
([Saltzer & Schroeder, 1975](https://en.wikipedia.org/wiki/Saltzer_and_Schroeder%27s_design_principles)).
A fresh clone with no env vars set:

- refuses to render the dashboard until a passkey login (`AUTH_DISABLED=1` opts
  out, for trusted local dev only),
- returns a friendly stub for AI chat (no `OPENROUTER_API_KEY` to leak),
- throws on boot in production if `AUTH_SECRET` is unset.

Misconfiguration fails **closed**, not open. The full posture and threat model
live in [SECURITY.md](../../SECURITY.md); the auth specifics in
[auth-and-providers.md](../reference/auth-and-providers.md).

## The AI is "Advisor"

The product's AI persona is always called **Advisor** — never "agent", "bot",
"assistant", or "AI" in user-facing copy. This is a voice decision (formal,
friendly, plain English) and it extends into code identifiers and DB enum values
(`source = 'advisor_tool'`). A single, non-dismissible disclaimer sits under the
chat input on every session, in exact wording:

> *Advisor is AI and can make mistakes.*

The complete copy/vocabulary rules — memory/session terms, timestamp handling —
are the single source of truth in
[AGENTS.md § Product copy](../../AGENTS.md#product-copy--vocabulary).

## Personal data never gets committed

Macrotide is a personal investing app, so the repo treats real financial data
as radioactive: no real fund codes, broker names, account names, balances, or
cost basis in code, fixtures, tests, or docs — only generic placeholders and
public, official data sources. Tests use synthetic data only. The enforceable
list is in [AGENTS.md § Personal data](../../AGENTS.md#personal-data--never-commit).

## One source of truth, everything else links

Duplicated prose is the main cause of doc drift, so each fact has exactly one
home and everything else links to it:

- **Feature status** → [README status board](../../README.md#status) (built) + [project board](https://github.com/users/Sitthinut/projects/2) (planned)
- **Environment variables** → [configuration.md](../reference/configuration.md#environment-variables)
- **Deploy steps** → [deploy.md](../how-to/deploy.md)
- **Schema** → [lib/db/schema/](../../lib/db/schema)

The docs in this folder explain and orient; they don't copy. This is the same
instinct behind the codebase's `see docs/...` comments and these docs'
`see lib/...` links — keeping documentation and code within sight of each other.

## From single-owner to multi-user

The app was built single-owner first and grows into multi-user without a
rewrite. The mechanism: most app tables carry a nullable `user_id`. In
single-owner mode it's `NULL` and the owner sees everything; multi-user mode
scopes every query by `user_id` (`requireUser()`, an `ownedBy()` filter that
collapses to "no user" when there's no session). Identity (passkey + optional
Google/GitHub), quotas, and tier gating are all **env-gated** — set nothing and
the app runs exactly as the single-owner version did.

This lets each capability ship and be tested behind a default-off switch rather
than in a risky big-bang cutover. The data shape is in
[data-model.md](../reference/data-model.md).

## Demo mode is fully isolated

Anyone can explore the app without an account via an isolated, in-memory
SQLite — seeded with realistic mock data, swept after idle, and capped so it
can't run up an AI bill. It shares **no** state with the owner database; the
isolation is enforced at the DB-routing layer, not by convention. See
[architecture § owner vs demo databases](./architecture.md#owner-vs-demo-databases).
