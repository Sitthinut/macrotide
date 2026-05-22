# Security policy

## Reporting a vulnerability

Please use GitHub's [private vulnerability reporting](https://github.com/Sitthinut/macrotide/security/advisories/new) — do not file a public issue for security bugs. You should hear back within 72 hours.

## Supported versions

The `main` branch receives all fixes. No semver-versioned releases yet — the project is pre-1.0 and changes are rolling.

## Design principle: secure by default

Macrotide follows the **secure-by-default** principle, one of [Saltzer & Schroeder's 1975 design principles](https://en.wikipedia.org/wiki/Saltzer_and_Schroeder%27s_design_principles): the safe configuration is the default, and you opt *in* to riskier behavior. A fresh checkout with no env vars set should never expose data.

| Setting | Default | Why |
| --- | --- | --- |
| Passkey auth | required | Dashboard refuses to render until a passkey login. Set `AUTH_DISABLED=1` to opt out (local dev only). |
| Demo session | not started | Per-visit opt-in. Each session gets its own in-memory SQLite, swept after 1h idle. |
| OpenRouter key | unset | Chat returns a stub message. A fresh checkout has no API credentials to leak. |
| Bind address | `0.0.0.0:3000` (Next.js dev default) | ⚠ Anyone on your LAN can hit dev. Use `next dev -H 127.0.0.1` for solo dev. |
| Owner DB | `data/app.db`, unencrypted | SQLite file. Use disk encryption + filesystem permissions on a shared host. |

## Threat model

### We defend against

- **Anonymous network visitors reading the owner's portfolio.** Passkey auth blocks the dashboard. Unauthenticated requests get bounced to `/login`.
- **Cross-session leakage in demo mode.** Each demo session is its own in-memory SQLite, keyed by cookie, swept after 1h idle.
- **Brute-force on `/api/chat`.** IP-based rate limit, 20 req/min (per-IP, in-memory).
- **Brute-force on `/api/auth/*`.** IP-based rate limit, 10 req/min.
- **Demo abuse.** 10 chat turns per session cap, separate AI provider key supported so demo can't burn owner quota.
- **Common web vulns at framework level.** Next.js handles CSRF for App Router server actions, React escapes output by default, biome-lint flags `dangerouslySetInnerHTML` usage.

### We do NOT defend against

- **Shell access to the host.** Anyone who can read `data/app.db` can read all portfolios. SQLite is unencrypted. Mitigate with disk encryption and filesystem permissions (`chmod 600`).
- **Compromised passkey device.** Possessing a passkey === being the user. Lose your laptop without a screen lock, lose access. Register passkeys on multiple devices as a recovery path.
- **OpenRouter side.** Portfolio context is sent to OpenRouter for chat. If their infra is compromised, that data is exposed. Don't chat about info you wouldn't share with a cloud LLM.
- **Multi-tenant isolation at the DB level.** There is no row-level security — multi-user mode trusts the auth layer to attribute writes correctly. Audit before deploying to >10 users; consider a dedicated DB per user instead.
- **Side-channel attacks on auth.** No timing-attack hardening on top of better-auth's internals. We don't add a custom layer.
- **Supply-chain attacks on dependencies.** No SBOM, no signed releases yet. `npm audit` is your friend; Dependabot is on the roadmap.

## Reporting near-misses

If you tried something that *almost* worked — a misconfiguration that nearly exposed data, a path that *should* have been auth-gated — please report it the same way. Near-misses are how we tighten the defaults further.
