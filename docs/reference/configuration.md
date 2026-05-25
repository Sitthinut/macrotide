# Configuration

How Macrotide reads configuration, and where the authoritative list lives.

## How it works

All runtime configuration comes from **environment variables**, read from
`.env.local` in development (gitignored) and from the process environment in
production (e.g. a systemd `EnvironmentFile`; see [deploy.md](../how-to/deploy.md)).

- `.env.example` is a **thin template** — copy it to `.env.local` and fill in.
- The app is **secure by default**: a fresh checkout with no vars set refuses to
  render the dashboard (auth required) and returns AI chat stubs (no key). You
  opt *in* to riskier or richer behavior. See
  [design principles](../explanation/design-principles.md).

## The canonical variable table

To avoid drift, every variable — its default, the code that reads it, and its
behavior — is documented in **one** place:

➡️ **[AGENTS.md § Environment variables](../../AGENTS.md#environment-variables)**

That table is the single source of truth. This page intentionally does **not**
duplicate it. The groups it covers:

| Group | Examples | Notes |
|---|---|---|
| AI / model selection | `OPENROUTER_API_KEY`, `AI_MODELS`, `OCR_MODEL`, `TITLE_MODEL` | Chat/OCR providers and model chains |
| Auth (better-auth) | `AUTH_SECRET`, `AUTH_DISABLED`, `AUTH_RP_NAME`, `PUBLIC_APP_URL` | `AUTH_SECRET` is mandatory in production |
| OAuth + signup gate | `GOOGLE_CLIENT_*`, `GITHUB_CLIENT_*`, `TURNSTILE_*` | All optional and env-gated; passkey-only when unset |
| Database | `DB_PATH` | SQLite file location |
| Quotas + tier gating | `DAILY_TOKEN_BUDGET_FREE`, `DAILY_TOKEN_BUDGET_TRUSTED` | Per-user metering (authenticated users only) |
| External data | `SEC_API_KEY` | Thai SEC Open API for fund NAVs |
| Dev / framework | `DEV_ALLOWED_ORIGIN`, `CODEX_AUTH_FILE`, `NODE_ENV` | |

## When you change a variable

Update these together, in the same commit — never one without the others:

1. The canonical table in [AGENTS.md](../../AGENTS.md#environment-variables).
2. [.env.example](../../.env.example) (the template).
3. [auth-and-providers.md](./auth-and-providers.md) and/or [deploy.md](../how-to/deploy.md) where they
   reference the specific variable.

This rule is itself recorded in [AGENTS.md](../../AGENTS.md#source-of-truth-for-whats-done).
