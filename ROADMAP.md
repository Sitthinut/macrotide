# Roadmap

> **Status:** Active. The forward-looking plan for Macrotide. Shipped history
> lives in [CHANGELOG.md](./CHANGELOG.md) — this doc is **what's next**, not
> what's done. Last restructured 2026-05-24 (history split out to the
> changelog; see [How to read this doc](#how-to-read-this-doc)).

The app is past its static-data prototype stage: persistence, AI chat with
advisor tool-calls, market data, portfolio import, long-term memory, and the
multi-user foundation have all shipped (see the [changelog](./CHANGELOG.md)).
What remains is finishing the public-launch hardening and a short list of
forward work.

---

## How to read this doc

- **Roadmap = intent; changelog = history.** If a line describes something
  already true in the running app, it belongs in [CHANGELOG.md](./CHANGELOG.md),
  not here. This doc holds goals, open work, design sketches for unbuilt
  features, locked decisions, and what's explicitly out of scope.
- **Source of truth for *planned* feature status** is the
  [Phases at a glance](#phases-at-a-glance) table. Shipped phases collapse to a
  one-line row that links to the changelog and/or the feature doc under `docs/`.
- **The implementation-order list in each open phase is a contract.** When you
  change it, leave a one-line note explaining why.

See [AGENTS.md](./AGENTS.md) for the conventions an agent needs before touching
code (DB routing, demo mode, env vars, where things live).

## Documentation conventions

The roadmap is the **what's next**; detailed feature designs live under `docs/`
(Diátaxis: `tutorials/`, `how-to/`, `reference/`, `explanation/`), one file per
feature, capped ~600 lines before splitting into a folder. Only
convention-mandated files stay at the repo root: `README.md`, `AGENTS.md`,
`SECURITY.md`, `ROADMAP.md`, `CHANGELOG.md`, `LICENSE`.

**Update cadence — docs change with the code that touches them, same commit:**

- Ship a behavior change → add a one-line entry under `## [Unreleased]` in
  [CHANGELOG.md](./CHANGELOG.md), described by capability.
- Change a phase's planned deliverables → update this file's phase section + the
  glance table.
- See [Doc stewardship](#doc-stewardship) for the full "when you change X,
  update Y" map.

Publishing layer (GitBook / MkDocs) gets added once there are ~5+ feature docs
worth surfacing publicly; until then GitHub's markdown renderer is fine. When
that happens, surface the changelog there by rendering `CHANGELOG.md` — don't
maintain a second copy.

---

## Phases at a glance

Shipped rows link to the [changelog](./CHANGELOG.md) for the detail; open rows
link to their section below.

| # | Phase | Status | Notes |
| - | --- | --- | --- |
| 1 | Persistence | ✅ Shipped | SQLite + Drizzle, daily backups. |
| 2 | AI chat + advisor tool-calls | ✅ Shipped | Streaming, history, tool-calls, plan-edit cards, analysis score. 🧪 live-LLM browser verify outstanding. |
| 2.5 | Passkey + demo | ✅ Shipped | Single-owner auth + per-session in-memory demo DB. |
| 2.6 | Chat persistence & cleanup | ✅ Shipped | Chat history persists; plan-edit Apply wired; mock imports migrated out. |
| 3 / 3b / 3c | Market data | ✅ Shipped | SET/global indices (Yahoo), Thai fund NAVs + history (Thai SEC), RSS news. |
| 4 | Portfolio import | ✅ Shipped | CSV + manual autocomplete + image OCR, with advisor-assist handoff (transcription → reviewable holding cards). |
| 4b | Broker scraping / API | 📥 Backlog | TOS/maintenance burden — see [Backlog](#backlog). |
| 5 | Long-term memory + chat archival | ✅ Shipped | Memory foundation + session lifecycle + real-time extraction + recall/FTS. Guide: [docs/explanation/memory.md](./docs/explanation/memory.md). 5c+ → [Backlog](#backlog). |
| 5b | Scheduled NAV refresh | ⬜ Not started | Cheap + useful solo — see [below](#open--phase-5b-scheduled-nav-refresh). Digests/notifications → [Backlog](#backlog). |
| 6 | Multi-user (public launch) | 🟡 Code shipped; launch prep open | Per-user scoping, tier gating, fail-closed hardening, and owner admin UI all shipped. **Open: `/legal/*` review + browser-verify.** See [below](#open--phase-6-finish-the-public-launch). OAuth → [Backlog](#backlog). |

## Why this build order

Easiest → hardest, lowest risk → highest risk: **persistence** (mechanical,
unlocks everything) → **AI chat** (highest user value) → **market data**
(moderate plumbing) → **portfolio import** (hardest; unreliable data sources) →
**multi-user** (only needed before sharing a deployment). Aesthetics come last
and inline, not as a phase — real data exposes the gaps worth polishing.

---

## Open work

### Open — Phase 6: finish the public launch

**Goal:** open the app to family/friends via a public link. Each account is
isolated; the owner's OpenRouter budget is protected by per-user token caps and
free-tier-only access for new accounts. No transactional email.

The multi-user machinery is built and on `main`: per-user scoping (migrations
`0007`/`0008`), env-gated Google/GitHub OAuth, quotas + tier gating, the
Turnstile sign-up gate (bypassed when unset), and the account page. What's left
is launch readiness.

**Multi-tenant hardening status** (the public link means *anyone* can reach
signup, so data isolation is load-bearing):

1. **Fail-closed scoping — ✅ done.** `ownedBy()` is default-deny for logged-in
   users; built-ins opt in explicitly. See
   [lib/db/queries/scope.ts](./lib/db/queries/scope.ts).
2. **Per-user `plans` — ✅ done.** Migration `0008`; `getPlan`/`upsertPlan`
   scoped per user. See [lib/db/queries/plan.ts](./lib/db/queries/plan.ts).
3. **Owner admin surface — ✅ done.** An owner-only page (list users, flip
   `free`↔`trusted`) replacing manual `UPDATE account_tier` SQL — gated on
   `OWNER_EMAIL` and enforced server-side on every request, with a self-demote
   guard. Tier is read per request, so a change applies on the user's **next
   request**.
4. **Default posture — ✅ at code level.** New signups get `free` (own isolated
   data, free models only); the owner promotes to `trusted`. A "your account is
   pending an upgrade" affordance is a remaining nicety.

**Remaining operator setup (needs the user's hands):**

- [x] Cloudflare **Turnstile** keys → `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` set
      (2026-05-24); the sign-up gate now enforces instead of bypassing. Restart
      the app to pick them up, and set the same two keys in the **production**
      env at deploy.
- [ ] Review the `/legal/terms` + `/legal/privacy` copy (jurisdiction, contact,
      operator name, effective date).
- [ ] **Browser-verify** end-to-end, including per-user isolation with a second
      test account, passkey revoke + lockout guard, and the limit banner.
- [x] Owner admin UI integrated — gates on `OWNER_EMAIL` read at runtime (so it
      must be present in the running app's env, not just for the backfill script).

**Locked invariants for this phase** (keep them tested):

- The `free` tier can **never** resolve to a non-free model regardless of
  `AI_MODELS` env — a config slip otherwise burns the budget.
- Every app route returns 401 without a session and only that user's rows with
  one. A leak test runs as user A and asserts zero rows for B.
- `OPENROUTER_API_KEY` never appears in browser-visible payloads.
- `OCR_MODEL` must be a **paid no-train** vision model in any multi-user deploy
  — free-tier providers train on submissions, incompatible with other users'
  portfolio screenshots (see [Locked decisions](#locked-decisions)).
- `PUBLIC_APP_URL` is pinned in production — changing it breaks passkey `rpID`
  and OAuth callback URIs.

**Out of scope for Phase 6:** SAML/enterprise OIDC, org/team accounts, billing/
paywall, magic-link email, Apple OAuth — add any of them only if a real user
needs it. Realtime *collaborative* editing is out (index investing is
single-owner, low-frequency); a sharing/roles model (`portfolio_members` with
owner/editor/viewer) is the ceiling, and only if a concrete shared workflow
appears.

### Open — Phase 5b: scheduled NAV refresh

Today NAVs are fetched on-demand and cached (5-min quotes, 24h history). A
scheduled refresh would proactively pull after the Thai SEC's 17:30 Bangkok
window so charts are fresh without a user trigger. The fetching already works;
only the scheduling is missing. The `closeStaleSessions` memory backstop
(`npm run jobs:close-stale`) is the other job that wants a scheduler — its
primary close path is real-time, so this is just a safety sweep. Needs a
scheduler/cron decision. (Weekly digest email + push notifications →
[Backlog](#backlog).)

---

## Locked decisions

Kept here so re-cloners and future-you don't re-litigate. Genuinely contentious
ones may graduate to `docs/decisions/`.

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

**Durable rules that outlive any one phase:**

- **Portable Drizzle subset** — `mode: "json"` columns, `boolean()` (not raw
  0/1), ISO-8601 date strings, typed JSON access (no `json_extract` in app
  code), `index()` builder (not raw DDL), enums as TEXT validated at the Zod
  boundary. This keeps the SQLite → Turso / Postgres doors open.
- **No private / unofficial data sources** in code or docs — TOS/brand
  exposure for an experimental app. Gaps in the SEC API get raised as a
  discussion, never quietly scraped.
- **OCR no-train for any multi-user deploy** — portfolio screenshots carry
  account-identifying data. The `openrouter/free` default trains on
  submissions; production must pin a paid no-train vision model (`OCR_MODEL`,
  e.g. an Anthropic/OpenAI/Google model via OpenRouter) or disable the Image
  tab. Not enforced in code — operator responsibility, an acceptance gate for
  the public launch.
- **Sensitive-data hygiene** — don't persist what you don't need (image bytes
  never touch disk); TTL anything that does (OCR text in chat, future
  `holding_proposals.source_text`); account deletion must cascade to all a
  user's data; audit metadata (counts/model/timestamp), never content; rely on
  disk-level encryption (LUKS / provider EBS) documented in
  [deploy.md](./docs/how-to/deploy.md), not app-level column encryption.
- **`NULL` user_id was fail-open** (shared built-in vs. unowned-by-accident
  were indistinguishable). Resolved 2026-05-24 by making `ownedBy()`
  default-deny with explicit opt-in for genuinely-shared rows; keep it that way.

---

## Backlog

> Parked 2026-05-24 to keep the roadmap focused on what's actually next. Not
> abandoned — each is a deliberate "later," revisited on real need rather than
> on a schedule.

- **Google + GitHub OAuth sign-in** (was Phase 6) — passkey-only login covers
  launch; social SSO is a convenience add. The code path is env-gated and
  already merged; flip it on by registering the OAuth apps + setting the client
  vars when a real user wants it.
- **Scheduled jobs: weekly digest email + push notifications** (was Phase 5b) —
  needs a scheduler/cron decision and (for digests) email transport, which the
  project deliberately avoids. Scheduled **NAV refresh** stays an open item
  under Phase 5b (cheap, useful even solo).
- **Vector recall / offline memory consolidation** (was Phase 5c+) — current
  FTS-based recall is enough; revisit only if recall quality demands embeddings.
- **Broker scraping / unofficial APIs** (was Phase 4b) — TOS + maintenance
  burden; only if a clear personal need emerges. No scraper lands without a
  discussion first.

## Explicitly out of scope (until you decide otherwise)

- **Open SaaS / billing / self-serve upgrade / admin web UI beyond tier
  toggling** — public sign-up defaults to free-tier; tier promotion is owner-
  driven.
- **Horizontal scaling / multi-region** — single VM, single SQLite writer; the
  trigger to change is migrating to Turso/Postgres, not layering on SQLite.
- **Aesthetic overhaul** — handled inline per phase.
- **Mobile-native app / PWA** — desktop / mobile web only.
- **Enterprise SSO (SAML/OIDC), org accounts, magic-link email** — see Phase 6
  out-of-scope.

---

## Deployment

Two supported modes; both first-class. The full runbook (systemd unit,
Caddyfile, firewall gotchas, backup mirroring, env reference) is in
[docs/how-to/deploy.md](./docs/how-to/deploy.md) — this is the summary.

- **Mode A — localhost (single user):** `npm install && npm run dev`. SQLite at
  `data/app.db`, backups in `data/backups/`. No auth, no env beyond
  `OPENROUTER_API_KEY`.
- **Mode B — single-owner self-host:** one Linux VM, Caddy reverse proxy
  (automatic HTTPS), systemd to keep Node alive, SQLite on disk with daily
  backups mirrored off-VM (e.g. Cloudflare R2 via `rclone`). Owner signs in with
  a passkey; visitors can try the demo. For inviting family/friends with their
  own accounts, complete the [Phase 6 launch prep](#open--phase-6-finish-the-public-launch).

---

## Doc stewardship

Stale docs are this project's #1 failure mode. Every code change that ships a
feature **must** include the matching doc update in the same commit.

| When you change… | Update… |
| --- | --- |
| Shipped a behavior change | [CHANGELOG.md](./CHANGELOG.md) `## [Unreleased]` (by capability) |
| A planned phase's deliverables | [ROADMAP.md](./ROADMAP.md) phase section + glance table |
| Status / what works today | [README.md](./README.md) status block |
| Env vars | [.env.example](.env.example) + [auth-and-providers.md](./docs/reference/auth-and-providers.md) + [deploy.md](./docs/how-to/deploy.md) + [AGENTS.md](./AGENTS.md) env table |
| Auth or security posture | [SECURITY.md](./SECURITY.md) + [auth-and-providers.md](./docs/reference/auth-and-providers.md) |
| Deployment topology | [deploy.md](./docs/how-to/deploy.md) |
| Conventions an agent must know | [AGENTS.md](./AGENTS.md) |
| External data source (provider, API) | feature doc under `docs/` + [SECURITY.md](./SECURITY.md) if it touches auth |

A doc reference to a function, env var, or file path is a contract: when you
rename/move/delete it, `grep -rn "thing" *.md docs/` and fix the references.
