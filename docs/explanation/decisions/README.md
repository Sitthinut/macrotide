# Decisions

Settled technical decisions for Macrotide, kept so re-cloners and future-you
don't re-litigate them. This is the rationale log; forward-looking plans live on
the [GitHub Project board](https://github.com/users/Sitthinut/projects/2), shipped
history in [CHANGELOG.md](../../../CHANGELOG.md).

Lightweight by design — a table for the one-line picks, prose for the rules that
outlive any single decision. A genuinely contentious decision can graduate to
its own numbered ADR file in this folder when it needs the full
context/options/consequences treatment.

## Picks

| Decision | Picked | Why not the alternative |
| --- | --- | --- |
| ORM | Drizzle | Prisma heavier; raw SQL loses types |
| Client data layer | SWR | React Query overkill at this scale |
| AI provider | Vercel AI SDK + OpenRouter | Direct Anthropic SDK locks to one provider |
| Chat model | `AI_MODELS` env (fallback chain), `openrouter/auto` default | Hardcoding one model = a one-string change every model bump |
| Auth | better-auth + passkey + (env-gated) Google/GitHub | NextAuth heavier, Clerk/Auth0 vendor cost + lock-in |
| Email transport | **Skip entirely** — SSO + passkeys only | DNS + spam-folder UX is friction for a soft-public launch |
| Thai fund data | Thai SEC Open API — official, free w/ key | Scraping fund supermarkets = TOS/legal exposure |
| Sign-up bot defense | Cloudflare Turnstile | hCaptcha works too; Turnstile is already in the zone |
| Storage scale | Single VM, single SQLite writer | Postgres/Turso only when a real scaling trigger appears |

## Durable rules

Rules that outlive any one decision above:

- **Portable Drizzle subset** — `mode: "json"` columns, `boolean()` (not raw
  0/1), ISO-8601 date strings, typed JSON access (no `json_extract` in app
  code), `index()` builder (not raw DDL), enums as TEXT validated at the Zod
  boundary. This keeps the SQLite → Turso / Postgres doors open.
- **No private / unofficial data sources** in code or docs — TOS/brand
  exposure for an experimental app. Gaps in the SEC API get raised as a
  discussion, never quietly scraped.
- **Sensitive-data hygiene** — don't persist what you don't need (image bytes
  never touch disk); TTL anything that does (OCR text in chat, future
  `holding_proposals.source_text`); account deletion must cascade to all a
  user's data; audit metadata (counts/model/timestamp), never content; rely on
  disk-level encryption (LUKS / provider EBS) documented in
  [deploy.md](../../how-to/deploy.md), not app-level column encryption.
- **`NULL` user_id was fail-open** (shared built-in vs. unowned-by-accident
  were indistinguishable). Resolved 2026-05-24 by making `ownedBy()`
  default-deny with explicit opt-in for genuinely-shared rows; keep it that way.
