# Authentication & AI providers

## Design principle: secure by default

Macrotide follows the **secure-by-default** principle ([Saltzer & Schroeder, 1975](https://en.wikipedia.org/wiki/Saltzer_and_Schroeder%27s_design_principles)): the safe configuration is the default, and you opt *in* to riskier behavior. A fresh clone with no env vars set will refuse to render the dashboard until you register a passkey. Misconfiguration fails closed, not open.

See [SECURITY.md](SECURITY.md) for the full threat model.

## Defaults

| Toggle | Env var | Default | Effect |
| --- | --- | --- | --- |
| Passkey auth | `AUTH_DISABLED=1` to opt out | required | Bounces visitors to `/login` until a passkey login. |
| Demo button | (always on) | available | Anyone can spin up an isolated in-memory SQLite, capped at 10 chat turns. |
| AI key | `OPENROUTER_API_KEY` | unset | Without it, chat returns a friendly stub message; rest of the app works. |

---

## Local dev (sole user on loopback)

```sh
cp .env.example .env.local
# In .env.local, uncomment to skip the passkey step in dev:
AUTH_DISABLED=1
# Optional — for real chat:
OPENROUTER_API_KEY=sk-or-...

npm run dev
```

Visit <http://localhost:3000>. No login, your data lives in `data/app.db`. **Only set `AUTH_DISABLED` when you control the bind address** — `next dev` listens on `0.0.0.0` by default, so anyone on your LAN can hit it. Use `next dev -H 127.0.0.1` if you're on an untrusted network.

## Shared deployment (default — secure)

```sh
cp .env.example .env.local
# In .env.local:
AUTH_SECRET=$(openssl rand -base64 32)
PUBLIC_APP_URL=https://macrotide.example.com
OPENROUTER_API_KEY=sk-or-...
```

No `AUTH_DISABLED` line — auth is already required by default.

On first visit the `/login` screen shows three buttons:

- **Sign in with passkey** — for returning users whose device has a passkey.
- **Create account** — collects name + email + registers a passkey on this device.
- **Try the demo** — spins an in-memory SQLite, capped chat.

### How passkeys work here

- Created via `@better-auth/passkey` plugin (WebAuthn / Web Credentials API).
- One device = one passkey. To use the app on phone + laptop, register from each device (or sync via iCloud Keychain / 1Password).
- Stored as a `passkey` row in the same SQLite as app data, with `publicKey` + `credentialID` + `counter` columns. We never see the private key — it lives on the device's secure enclave.
- Email/password is intentionally disabled to keep the auth surface small. Magic-link email is on the roadmap (needs a transactional sender).

---

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

If you want a specific model, set `AI_MODEL` to any id from [openrouter.ai/models](https://openrouter.ai/models). The default `openrouter/auto` lets OpenRouter pick the best model per prompt.

### Demo provider isolation

Demo chat is routed through `DEMO_OPENROUTER_API_KEY`. If unset, it falls back to `OPENROUTER_API_KEY` — that's fine when paired with the `openrouter/free` default model (zero-cost, no billing impact). For stricter isolation, create a second OpenRouter account with prepaid limits and use a separate key.

The `openrouter/free` router picks among ~25 free-tier models per request (volunteer GPUs; subject to OpenRouter's rate limits). For a pinned free model:

```sh
DEMO_AI_MODEL=meta-llama/llama-3.3-70b-instruct:free
```

---

## Rate limiting

`/api/chat` is IP-rate-limited at **20 requests/minute** regardless of demo / owner status. Demo sessions add a **10-turn-per-session** cap on top. Both are in-memory; replace with Upstash/Redis when you go multi-instance.

---

## Where the data lives

| Item | Storage |
| --- | --- |
| Owner user/session/passkey | `data/app.db` (better-auth tables) |
| Owner portfolio/journal/etc | `data/app.db` (app tables) |
| Demo session data | In-memory SQLite, keyed by demo cookie, swept after 1h idle |
| AI keys | `.env.local` (never committed; gitignored) |

To wipe demo state across the whole server, restart the process. To wipe the owner DB, delete `data/app.db` (back it up first — there's a daily auto-backup at `data/backups/`).
