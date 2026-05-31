# Authentication & AI providers

Reference for how sign-in and the AI provider work. For the *why*
(secure-by-default), see [design principles](../explanation/design-principles.md)
and [SECURITY.md](../../SECURITY.md). To *set it up*, see
[local development](../how-to/local-development.md) (dev) and
[deploy](../how-to/deploy.md) (shared deployment). Every env var named below is
defined in the canonical
[configuration.md § Environment variables](./configuration.md#environment-variables) table.

## Defaults

| Toggle | Env var | Default | Effect |
| --- | --- | --- | --- |
| Passkey auth | `AUTH_DISABLED=1` to opt out | required | Bounces visitors to `/login` until a passkey login. |
| Demo button | (always on) | available | Anyone can spin up an isolated in-memory SQLite, capped at 10 chat turns. |
| AI key | `OPENROUTER_API_KEY` | unset | Without it, chat returns a friendly stub message; rest of the app works. |

## Sign-in methods

On first visit the `/login` screen shows three options:

- **Sign in with passkey** — for returning users whose device has a passkey.
- **Create account** — collects name + email + registers a passkey on this device.
- **Try the demo** — spins an isolated, in-memory SQLite with capped chat.

Optional **Google / GitHub** sign-in and a **Turnstile** signup gate are
env-gated — hidden unless their keys are set (see the env-var table). The local
and shared setup commands live in [local development](../how-to/local-development.md)
and [deploy](../how-to/deploy.md).

### How passkeys work here

- Created via `@better-auth/passkey` plugin (WebAuthn / Web Credentials API).
- One device = one passkey. To use the app on phone + laptop, register from each device (or sync via iCloud Keychain / 1Password).
- Stored as a `passkey` row in the same SQLite as app data, with `publicKey` + `credentialID` + `counter` columns. We never see the private key — it lives on the device's secure enclave.
- Email/password is intentionally disabled to keep the auth surface small. Magic-link email is on the roadmap (needs a transactional sender).

## AI provider — OpenRouter

`/api/chat` resolves the model based on whether the request carries a demo cookie:

```text
                    demo cookie?
                  /              \
                yes               no
                 |                 |
   resolveDemoProvider()   resolveOwnerProvider()
   DEMO_OPENROUTER_API_KEY OPENROUTER_API_KEY
   defaults: openrouter/free   defaults: openrouter/auto
   capped at 10 turns      no cap, IP-rate-limited
```

### Why one provider

OpenRouter proxies every major model behind one API:

- Anthropic Claude · OpenAI GPT · Google Gemini · Meta Llama · Mistral · DeepSeek · Qwen · ...
- One key, one billing surface, one set of telemetry.
- Free-tier router (`openrouter/free`) covers demo use without billing.
- Pay per-token credit; load up via the OpenRouter dashboard.

If you want a specific model, set `AI_MODELS` to any id from [openrouter.ai/models](https://openrouter.ai/models). It's a comma-separated fallback chain — the first model is tried first, and the next one is used if the previous fails. The default `openrouter/auto` lets OpenRouter pick the best model per prompt. `AI_MODELS` also serves `tier='trusted'` users.

### Tier model selection + spend caps

A `tier='free'` user's chat model comes from its **own** `FREE_TIER_MODEL` var
(default `openrouter/free`), never from `AI_MODELS` — so an owner-chain change
can't widen free access. To lift free-tier quality, point it at a cheap paid
model:

```sh
FREE_TIER_MODEL=google/gemini-2.5-flash
```

Free-tier spend is bounded by two caps, checked before each request (either
tripping blocks the turn, both reset at UTC midnight):

- **Token cap** — `DAILY_TOKEN_BUDGET_FREE` (default 20k tokens/day). Always on.
- **Cost cap** — `DAILY_CENTS_BUDGET_FREE` (US cents/day). **Off unless set**; the
  right bound for a paid model with asymmetric in/out pricing. The per-turn cost
  estimate reads `MODEL_PRICES` (USD/Mtok), so set that to match `FREE_TIER_MODEL`.

Owner / `AUTH_DISABLED` mode is never metered. Full var table:
[configuration.md § Quotas + tier gating](./configuration.md#quotas--tier-gating).

### Demo provider isolation

Demo chat is routed through `DEMO_OPENROUTER_API_KEY`. If unset, it falls back to `OPENROUTER_API_KEY` — that's fine when paired with the `openrouter/free` default model (zero-cost, no billing impact). For stricter isolation, create a second OpenRouter account with prepaid limits and use a separate key.

The `openrouter/free` router picks among ~25 free-tier models per request (volunteer GPUs; subject to OpenRouter's rate limits). For a pinned free model:

```sh
DEMO_AI_MODELS=meta-llama/llama-3.3-70b-instruct:free
```

## Market data providers (indices / FX / stocks)

Markets-screen indicators and any `yahoo`-sourced holding resolve through a
provider chain, tried preferred → fallback. Each provider only matches the
symbols it actually serves, and the keyed ones **drop out of the chain entirely
when their env var is unset** — so the app degrades gracefully from real index
levels → ETF proxy → keyless Yahoo with no config:

```text
FMP (keyed, REAL US indices)
  → EODHD (keyed, REAL global indices + Thai SET)
    → Twelve Data (keyed, ETF proxies)
      → Frankfurter (keyless, FX only)
        → Yahoo (keyless)
```

| Provider | Env var | Free tier | Serves |
| --- | --- | --- | --- |
| FMP (Financial Modeling Prep) | `FMP_API_KEY` | ≈ 250 req/day | REAL US index levels — `^GSPC` (S&P 500), `^NDX` (Nasdaq-100), `^DJI` (Dow) |
| EODHD (EOD Historical Data) | `EODHD_API_KEY` | ≈ 20 req/day | REAL global index levels via `{CODE}.INDX` — incl. Nikkei (`N225.INDX`) and the Thai SET (`SET.INDX`) that FMP's free tier lacks |
| Twelve Data | `TWELVE_DATA_API_KEY` | ≈ 800 req/day | ETF proxies (SPY/QQQ/DIA/THD/…) for index symbols not on a free real-index plan |
| Frankfurter | (none) | unmetered | FX only (USD/THB), ECB-backed; works with no key and no datacenter-IP block |
| Yahoo | (none) | — | keyless fallback; hard-429s datacenter IPs, hence the keyed providers above |

With **no keys** the chain is exactly Frankfurter (FX) → Yahoo; with **only**
Twelve Data set you get the prior ETF-proxy behaviour. MSCI ACWI has no free
real-index source and intentionally stays an ETF proxy (`ACWI`); gold stays the
`XAU/USD` spot commodity, not an index. Every var above is defined in the
canonical [configuration.md § Environment variables](./configuration.md#environment-variables)
table.

### Cache freshness

`getCachedSeries` ([lib/market/cache.ts](../../lib/market/cache.ts)) serves a
symbol's daily series and its latest quote from `data/market.db` for a 24h TTL
(`CACHE_TTL_MS`), refetching at most once a day.

The daily window follows from the provider quotas above rather than from how
often prices move. EODHD allows ~20 calls/day and FMP ~250/day, and the keyless
Yahoo fallback returns 429 from the datacenter prod IP. At ~1 fetch/day per symbol
the 24h window stays within quota; a 5-minute TTL (~288/day per symbol) would
exceed EODHD's and FMP's limits and fall back to the rate-limited Yahoo. So a
shorter quote TTL — and SWR `refreshInterval` polling on top of it — depends on a
higher-quota or unblocked provider, not on the TTL alone. (An earlier 5-minute
`QUOTE_TTL_MS` sat `void`-suppressed in the cache and read like dead code; it was
removed and its intent folded into the comment on `CACHE_TTL_MS`.)

A failed upstream is negatively cached for 3 min (`FAIL_BACKOFF_MS`) and the last
good value is served stale rather than blanked.

## Rate limiting

`/api/chat` is IP-rate-limited at **20 requests/minute** regardless of demo / owner status. Demo sessions add a **10-turn-per-session** cap on top. Both are in-memory; replace with Upstash/Redis when you go multi-instance.

## Where the data lives

| Item | Storage |
| --- | --- |
| Owner user/session/passkey | `data/app.db` (better-auth tables) |
| Owner portfolio/journal/etc | `data/app.db` (app tables) |
| Fund catalog/fees + NAV/quote cache | `data/market.db` (regenerable; not backed up) |
| Demo session data | In-memory app.db, keyed by demo cookie, swept after 1h idle; reads the shared real market.db |
| AI / provider keys | `.env.local` (never committed; gitignored) |

To wipe demo state across the whole server, restart the process. To wipe the owner DB, delete `data/app.db` (back it up first — there's a daily auto-backup at `data/backups/`).
