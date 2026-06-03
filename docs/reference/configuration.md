# Configuration

How Macrotide reads configuration, and the canonical list of every variable.

## How it works

All runtime configuration comes from **environment variables**, read from
`.env.local` in development (gitignored) and from the process environment in
production (e.g. a systemd `EnvironmentFile`; see [deploy.md](../how-to/deploy.md)).

- `.env.example` is a **thin template** — copy it to `.env.local` and fill in.
- The app is **secure by default**: a fresh checkout with no vars set refuses to
  render the dashboard (auth required) and returns AI chat stubs (no key). You
  opt *in* to riskier or richer behavior. See
  [design principles](../explanation/design-principles.md).

## Environment variables

The canonical reference for every `process.env.*` the app reads — default, the
code that reads it, and its behavior. This table is the single source of truth;
keep it in sync with [.env.example](../../.env.example) when adding/renaming vars
(see [When you change a variable](#when-you-change-a-variable)).

### AI / model selection

| Var | Default | Read by | Notes |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | — (required for live AI) | [lib/ai/provider.ts](../../lib/ai/provider.ts), [lib/portfolio/ocr.ts](../../lib/portfolio/ocr.ts) | Chat returns a stub response without it; OCR returns 503. |
| `AI_MODELS` | `openrouter/free,openrouter/auto` | [lib/ai/provider.ts](../../lib/ai/provider.ts) | Comma-separated owner-chat fallback chain (also used by `tier='trusted'`). First model is primary. |
| `FREE_TIER_MODEL` | `openrouter/free` | [lib/ai/provider.ts](../../lib/ai/provider.ts) | Model chain for `tier='free'` chat. Read from its OWN var, never from `AI_MODELS` (the invariant below). Defaults to the zero-cost free router; point it at a cheap PAID model (e.g. `google/gemini-2.5-flash`) to lift free-tier quality — bounded by the daily token + optional cents caps. |
| `REASONING_GATE` | `on` | [lib/advisor/intent.ts](../../lib/advisor/intent.ts), [app/api/chat/route.ts](../../app/api/chat/route.ts) | Owner/trusted only: a deterministic classifier raises reasoning `effort` to `medium` on genuine multi-step turns (rebalance, SSF-vs-RMF, plan-anchored tilt) and `none` otherwise. Free/demo always stay `none` (cost-protected). Set `off` to inherit each model's default reasoning instead. Tune the trigger set against the eval (`EVAL_TIER=complex EVAL_REASONING=medium`). |
| `DEMO_OPENROUTER_API_KEY` | falls back to `OPENROUTER_API_KEY` | [lib/ai/provider.ts](../../lib/ai/provider.ts) | Separate key for demo traffic so demo can't burn owner quota. |
| `DEMO_AI_MODELS` | `openrouter/free` | [lib/ai/provider.ts](../../lib/ai/provider.ts) | Demo-chat model chain. Free-only by default. |
| `TITLE_MODEL` | `openrouter/free` | [lib/ai/provider.ts](../../lib/ai/provider.ts) | Cheap model for auto-titling a chat after its first turn pair (`POST /api/chat/threads/[id]/title`). **Never pin a Claude or GPT model here** — titling is a 3–5-word task and any non-mainstream free model (DeepSeek V3, Qwen3 small, etc.) is more than enough. Comma-separated chain accepted; first model is primary. |
| `OCR_MODEL` | `google/gemini-2.5-flash` | [lib/portfolio/ocr.ts](../../lib/portfolio/ocr.ts) | Add-holdings image extraction (vision). NOT tier-gated — same model for all users (bounded, rate-limited one-shot). Must be vision-capable. (Prior `baidu/qianfan-ocr-fast` was removed upstream.) |
| `OCR_FALLBACK_MODEL` | `google/gemini-2.0-flash-001` (only when `OCR_MODEL` is unset) | [lib/portfolio/ocr.ts](../../lib/portfolio/ocr.ts) | Auto-retry on provider error / rate-limit. Pinning `OCR_MODEL` disables the default fallback unless this is set explicitly. |
| `VISION_CHAT_MODEL` | `google/gemini-2.5-flash` | [lib/ai/provider.ts](../../lib/ai/provider.ts) `resolveVisionProvider`, [app/api/chat/route.ts](../../app/api/chat/route.ts) | Vision model for an **image-bearing chat turn** (the in-chat Advisor vision feature), across owner/trusted/free. Must be vision-capable; comma-separated fallback chain accepted. Read from its OWN var, never from `AI_MODELS`/`FREE_TIER_MODEL` — so free-tier vision can't widen the text chains (and stays bounded by the daily token + optional cents caps). Set to `off` (or `none`/`false`/empty) to disable inline chat vision entirely → image turns get a stub pointing at the Add-holdings importer. |
| `DEMO_VISION` | `off` | [lib/advisor/image-turn.ts](../../lib/advisor/image-turn.ts), [app/api/chat/route.ts](../../app/api/chat/route.ts), [app/api/chat/capabilities/route.ts](../../app/api/chat/capabilities/route.ts) | Opt-in (`on`/`1`/`true`/`yes`) to allow **demo** chat sessions to upload images. Off by default — demo hides the attach button and stubs image turns. When on, demo image turns use `VISION_CHAT_MODEL` with the demo key (`DEMO_OPENROUTER_API_KEY`), bounded by the 10-turn demo cap. |

The free-tier **model chain** is derived ONLY from its own `FREE_TIER_MODEL` var
(default `openrouter/free`) in code
([lib/ai/provider.ts](../../lib/ai/provider.ts) `resolveTierProvider`) and is
deliberately NOT derived from `AI_MODELS` — so a slip in the owner chain can
never widen free-tier access. Pointing free at a cheap paid model is a separate,
conscious operator act (`FREE_TIER_MODEL=…`), and free spend stays bounded by the
daily token cap plus the optional cents cost cap (see **Quotas + tier gating**).
`tier='trusted'` uses the `AI_MODELS` owner chain. Tier is stored in
`account_tier`; promote via SQL (`UPDATE account_tier SET tier='trusted' WHERE user_id=?`).

### Auth (better-auth)

| Var | Default | Read by | Notes |
| --- | --- | --- | --- |
| `AUTH_SECRET` | dev fallback (`macrotide-dev-secret-change-me`) | [lib/auth/index.ts](../../lib/auth/index.ts) | REQUIRED in production (boot throws if `NODE_ENV=production` and unset). |
| `AUTH_DISABLED` | unset | [app/page.tsx](../../app/page.tsx), [lib/auth/session.ts](../../lib/auth/session.ts), [lib/api/with-db.ts](../../lib/api/with-db.ts) | Set to `1` to skip the login gate on trusted local dev only. |
| `AUTH_RP_NAME` | `Macrotide` | [lib/auth/index.ts](../../lib/auth/index.ts) | Passkey relying-party display name. |
| `AUTH_RP_ID` | inferred from `PUBLIC_APP_URL` | [lib/auth/index.ts](../../lib/auth/index.ts) | Override only if you understand WebAuthn `rpID` rules. |
| `PUBLIC_APP_URL` | `http://localhost:3000` (implicit) | [lib/auth/index.ts](../../lib/auth/index.ts), [lib/portfolio/ocr.ts](../../lib/portfolio/ocr.ts) | Canonical URL. Used for OpenRouter `HTTP-Referer` and WebAuthn origin. Changing this in prod breaks existing passkeys. |
| `OWNER_EMAIL` | unset (no owner) | [scripts/backfill-owner.ts](../../scripts/backfill-owner.ts), [lib/auth/owner.ts](../../lib/auth/owner.ts) | Names the owner account. The backfill attaches `NULL`-owned rows to it + grants `trusted`; at runtime it identifies the owner for the admin UI (gate is **fail-closed** — unset → nobody is owner). **Must be in the running app's env, not just for the one-off script.** Run `npx tsx --env-file=.env.local scripts/backfill-owner.ts` once after migrating. Idempotent. |

### Auth — OAuth + signup gate

All optional and **env-gated**: with none set, the app runs passkey-only and the
`/login` page hides the OAuth buttons / Turnstile widget. A provider counts as
"enabled" only when BOTH its id and secret are present.

| Var | Default | Read by | Notes |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_ID` | unset | [lib/auth/providers.ts](../../lib/auth/providers.ts) | Enables "Continue with Google" (needs `GOOGLE_CLIENT_SECRET` too). |
| `GOOGLE_CLIENT_SECRET` | unset | [lib/auth/providers.ts](../../lib/auth/providers.ts) | Server-only. |
| `GITHUB_CLIENT_ID` | unset | [lib/auth/providers.ts](../../lib/auth/providers.ts) | Enables "Continue with GitHub" (needs `GITHUB_CLIENT_SECRET` too). |
| `GITHUB_CLIENT_SECRET` | unset | [lib/auth/providers.ts](../../lib/auth/providers.ts) | Server-only. |
| `TURNSTILE_SITE_KEY` | unset | [lib/auth/turnstile.ts](../../lib/auth/turnstile.ts), [/api/auth-config](../../app/api/auth-config/route.ts) | **PUBLIC** — shipped to the browser to render the widget. |
| `TURNSTILE_SECRET_KEY` | unset | [lib/auth/turnstile.ts](../../lib/auth/turnstile.ts) | Server verifies the email-signup token here (OAuth sign-in is not gated — the provider authenticates the user). **When unset, verification is BYPASSED (dev pass).** OAuth callback URIs for both providers must point at `<PUBLIC_APP_URL>/api/auth/callback/{google,github}`. |

Rate limiting: `/api/auth/*` POSTs are IP-limited via `AUTH_RATE_LIMIT`
(10/min/IP — [lib/api/rate-limit.ts](../../lib/api/rate-limit.ts)), wired in
[app/api/auth/[...all]/route.ts](../../app/api/auth/[...all]/route.ts).

### Legal pages

All optional and operator-configurable so the repo ships nothing
operator-specific; `/legal/terms` + `/legal/privacy` read them at render.

| Var | Default | Read by | Notes |
| --- | --- | --- | --- |
| `OPERATOR_NAME` | unset → "a single individual" / "the operator" | [lib/legal/config.ts](../../lib/legal/config.ts) | Who runs this instance, shown on both legal pages. |
| `CONTACT_EMAIL` | unset → no email, just "contact the operator" | [lib/legal/config.ts](../../lib/legal/config.ts) | Contact shown (as a `mailto`) on both pages. **No fallback to `OWNER_EMAIL`** — set this only to publish a real address. |
| `LEGAL_JURISDICTION` | unset → governing-law clause omitted | [lib/legal/config.ts](../../lib/legal/config.ts) | Governing-law jurisdiction (e.g. `Thailand`). |

The "Last updated" date is the `LEGAL_LAST_UPDATED` constant in
[lib/legal/config.ts](../../lib/legal/config.ts) (bump it when editing the copy, not
an env var). Sign-up consent is an inline notice under the create-account button
("By continuing, you agree to the Terms and Privacy Policy"), not a checkbox.

### Database

| Var | Default | Read by | Notes |
| --- | --- | --- | --- |
| `DB_PATH` | `data/app.db` | [lib/db/client.ts](../../lib/db/client.ts), [lib/mock/seed.ts](../../lib/mock/seed.ts) | app.db (system of record) path. Relative paths resolved from CWD; parent dir auto-created. |
| `MARKET_DB_PATH` | `data/market.db` | [lib/db/client.ts](../../lib/db/client.ts) | market.db (regenerable market data) path. Same `data/` volume as app.db; not backed up. |

### Quotas + tier gating

Per-user metering only applies to **authenticated** requests. Single-owner /
`AUTH_DISABLED` mode (`getUserId()` === null) is never metered, and demo
sessions are bounded by the demo turn cap, not these budgets.

| Var | Default | Read by | Notes |
| --- | --- | --- | --- |
| `DAILY_TOKEN_BUDGET_FREE` | `20000` | [lib/db/queries/usage.ts](../../lib/db/queries/usage.ts) | Daily input+output token cap per `tier='free'` user. Checked before forwarding to OpenRouter; resets at UTC midnight. Malformed/≤0 → default. Always on (the floor). |
| `DAILY_TOKEN_BUDGET_TRUSTED` | `200000` | [lib/db/queries/usage.ts](../../lib/db/queries/usage.ts) | Same, for `tier='trusted'` users. |
| `DAILY_CENTS_BUDGET_FREE` | unset → **cost cap OFF** | [lib/db/queries/usage.ts](../../lib/db/queries/usage.ts) | Optional daily **cost** ceiling in US cents per `tier='free'` user — the right bound when `FREE_TIER_MODEL` is a paid model with asymmetric in/out pricing. Checked alongside the token cap (either tripping blocks the turn). Unset or malformed/≤0 → disabled (no invented money cap; the token cap still applies). |
| `DAILY_CENTS_BUDGET_TRUSTED` | unset → **cost cap OFF** | [lib/db/queries/usage.ts](../../lib/db/queries/usage.ts) | Same, for `tier='trusted'` users. |
| `MODEL_PRICES` | built-in table | [lib/db/queries/usage.ts](../../lib/db/queries/usage.ts) | JSON map `{"<model-id>":{"in":<USD/Mtok>,"out":<USD/Mtok>}}` keyed by the model id OpenRouter reports back, merged OVER the built-in prices. Drives the per-turn cost estimate that feeds `DAILY_CENTS_BUDGET_*`. Set it to match whatever `FREE_TIER_MODEL` resolves to. Unpriced (free) models contribute 0 cost. Malformed JSON → built-ins. |

The cost cap is **off by default** — until you both set a `DAILY_CENTS_BUDGET_*`
and run a priced model, only the token cap bites. Cost is an *estimate*
(`served tokens × MODEL_PRICES`), not a provider-reported charge.

### External data sources

| Var | Default | Read by | Notes |
| --- | --- | --- | --- |
| `SEC_API_KEY` | — (Thai funds render as "—" without it) | [lib/market/providers/sec-thailand.ts](../../lib/market/providers/sec-thailand.ts) | Thai SEC Open API subscription key (Primary or Secondary — both valid). Header: `Ocp-Apim-Subscription-Key`. Covers all 6 product groups under one subscription. |
| `FMP_API_KEY` | — (chain falls through to EODHD → ETF proxy → Yahoo) | [lib/market/providers/fmp.ts](../../lib/market/providers/fmp.ts) | Financial Modeling Prep. REAL US index levels for `^GSPC`/`^NDX`/`^DJI` via `/api/v3/historical-price-full`. Free tier ≈ 250 req/day — first in the `yahoo` chain for the US indices it covers. Matches only those symbols + only when set. |
| `EODHD_API_KEY` | — (chain falls through to ETF proxy → Yahoo) | [lib/market/providers/eodhd.ts](../../lib/market/providers/eodhd.ts) | EOD Historical Data. REAL global index levels via `{CODE}.INDX` (e.g. `GSPC.INDX`, `NDX.INDX`, `N225.INDX`, **`SET.INDX`** for Thailand). Free tier ≈ 20 req/day — second in the chain; covers Nikkei + SET that FMP's free tier lacks. Matches only mapped index symbols + only when set. |
| `TWELVE_DATA_API_KEY` | — (falls back to keyless Yahoo, which 429s from datacenter IPs) | [lib/market/providers/twelvedata.ts](../../lib/market/providers/twelvedata.ts) | ETF-proxy layer for `yahoo`-sourced series (Markets indicators, FX, stocks). When set, used after FMP/EODHD; maps index symbols to tracking ETFs (SPY/QQQ/DIA/THD/…) since raw index symbols aren't on the free plan. Free tier ≈ 800 req/day, 8 req/min. ACWI stays an ETF; Gold stays XAU/USD. |

### Dev-only

| Var | Default | Read by | Notes |
| --- | --- | --- | --- |
| `CODEX_AUTH_FILE` | OS-default Codex auth path | [lib/ai/codex.local.ts](../../lib/ai/codex.local.ts) | Path to a Codex CLI auth JSON file, used by the local-codex integration during development. Test-only outside of dev. |
| `DEV_ALLOWED_ORIGIN` | unset (localhost only) | [next.config.ts](../../next.config.ts) | One extra origin added to Next's `allowedDevOrigins` so the dev server trusts a non-localhost host (reverse proxy, Codespaces, LAN IP, tunnel). Hostname only, no scheme. No effect on prod builds. |

### Framework

| Var | Default | Read by | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` (set by Next.js / build tooling) | [lib/auth/index.ts](../../lib/auth/index.ts) | Gates the `AUTH_SECRET` requirement and cookie `secure` flag. |

## When you change a variable

Update these together, in the same commit — never one without the others:

1. The table above.
2. [.env.example](../../.env.example) (the template).
3. [auth-and-providers.md](./auth-and-providers.md) and/or [deploy.md](../how-to/deploy.md) where they
   reference the specific variable.

This rule is also recorded in the [AGENTS.md doc-stewardship table](../../AGENTS.md#source-of-truth-for-whats-done).
