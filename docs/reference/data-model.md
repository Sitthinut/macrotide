# Data model

Macrotide stores data in **two** SQLite databases via Drizzle ORM, split along a
lifecycle boundary. The schema is defined in `lib/db/schema/` (split into
[app.ts](../../lib/db/schema/app.ts) + [market.ts](../../lib/db/schema/market.ts),
re-exported from `index.ts`) — **those files are the source of truth**; this page
is an orientation map. Migrations live in `lib/db/migrations/` and run
automatically on boot.

## The two databases

- **app.db** (`DB_PATH`, default `data/app.db`) — the **system of record**:
  accounts/auth, buckets, holdings, plans, journal, models, settings, chat,
  preferences, usage/tier, and `user_market_indicators`. Precious; backed up
  nightly. Reached via `getAppDb()` (alias `getDb()`).
- **market.db** (`MARKET_DB_PATH`, default `data/market.db`) — **regenerable**
  market data: the fund catalog/fees/performance/portfolio, feeder look-through,
  and the NAV/quote cache (`fund_quotes`/`nav_history`). Rebuilt from upstream;
  **not** backed up. Reached via `getMarketDb()`.

No FK or SQL join crosses the boundary. `holdings` links to market data only via
the soft `quote_source` + `ticker` cache key, resolved in app code (never a
join); a query module touching both reads each handle and joins app-side. Both
files sit under the same `data/` volume. Demo sessions get an isolated in-memory
app.db but share the real market.db read-write (same warm cache as real users).

## Tables at a glance

### Application data (app.db)

| Table | Holds | Key columns / notes |
|---|---|---|
| `buckets` | Portfolio slices (Core, SSF, experiment, …) | `target_allocation` (JSON), `target_model_id`, `position` (sidebar order), `user_id` |
| `holdings` | Fund positions inside a bucket | `bucket_id` (FK, cascade), `units`, `avg_cost`, `ter`, `quote_source` (routing key) |
| `plans` | The investment plan | Single-row in v1; `markdown`, `selected_model_id`, `user_id` |
| `journal_entries` | Notes, decisions, questions, reading, and feedback (a `kind: "feedback"` entry records a 👍/👎 reaction — e.g. a Portfolio "Not for me" rejection — with its rating in a `rating:up\|down` tag) | `kind`, `tags` (JSON), `pinned`, `archived_at`, `user_id` |
| `model_portfolios` | Built-in + custom model allocations | `built_in`, `allocation` (JSON slices), risk/return metadata, `user_id` |
| `action_item_states` | Archive / "Not for me" suppression for generated Portfolio action items (fee-creep flags today) | one row per (`user_id`, `item_key`); `state` ∈ archived / not_for_me, optional `reason` (chip key or free text), `snapshot_savings_pp` (magnitude baseline for the resurface check), `item_type`. Keyed by a deterministic `item_key` (`lib/portfolio/action-item-key.ts`) since the items carry no row of their own. (`snooze_until` is a dormant legacy column — Snooze is dropped.) |
| `settings` | Generic key-value app settings | `key` → `value` (JSON) |

### Market data (market.db — written by the market layer + the SEC crawl)

| Table | Holds | Key columns / notes |
|---|---|---|
| `fund_quotes` | Latest NAV + performance per ticker | `ticker` PK, `nav`, `d1_pct`, `ytd_pct`, `y1_pct`, `deepest_range` (widest series range fetched — lets a wider request deepen a fresh-but-shallow cache) |
| `nav_history` | Daily NAV (+ fund AUM) history — **append/update only, never time-pruned** | Composite PK (`ticker`, `date`); `nav`, `net_asset` (fund total net assets / AUM, when the source reports it) |
| `fund_catalog` | SEC-sourced fund universe (parent-level: one row per `proj_id`) | keyed by `proj_id`; `current_ter` is a **derived cache** of the latest TER (maintained by `upsertFundFees`; source of truth stays `fund_fees`) so the finder can sort/annotate fees without a fee-history query |
| `fund_share_classes` | The **priceable units** of each fund (one row per SEC share class) | composite PK (`proj_id`, `class_name`); `ticker` is `UNIQUE` and is the holdable/cache-key id — see below |
| `fund_fees` | Fee history per fund class | source of truth for TER |
| `fund_performance`, `fund_asset_allocation`, `fund_top_holdings`, `fund_portfolio`, `fund_portfolio_asset_type` | Per-fund enrichment depth | ingested behind default-off crawl flags; composite `(proj_id, period)` indexes |
| `feeder_master_map`, `feeder_look_through_holdings` | Feeder-fund → US master look-through | from SEC EDGAR N-PORT |

> Cache keys in `fund_quotes`/`nav_history` are the combined `${source}:${ticker}`
> so one table holds quotes from different providers without a schema change.
> See [AGENTS.md § Provider routing](../../AGENTS.md#provider-routing-via-holdingsquote_source).

#### Parent fund vs. share classes

`fund_catalog` is **parent-level** — one row per `proj_id` carries fund-level
metadata (name, AMC, policy, region, feeder relationship). But NAV, fees, tax
wrapper, and distribution policy differ **per share class**, so each priceable
class gets its own row in **`fund_share_classes`**:

| Column | Holds |
|---|---|
| `proj_id` | Parent fund (FK → `fund_catalog`, cascade delete) |
| `class_name` | Raw SEC `fund_class_name` (`"main"` for single-class funds, e.g. `"MDIVA-A"` for multi-class) |
| `ticker` | The **priceable id** — holdable identifier + NAV cache-key tail |
| `class_detail_th` | Raw Thai class detail string |
| `distribution_policy` | `accumulating` \| `dividend` \| NULL (parsed from `class_detail_th`) |
| `investor_type` | `retail` \| `institutional` \| `insurance` \| NULL — only retail is buyable by individuals |
| `tax_incentive_type` | Per-class wrapper: `SSF` \| `RMF` \| `ThaiESG` \| NULL |
| `isin_code` | Per-class ISIN |
| `current_ter` | Per-class total expense ratio %, derived from `fund_fees` (NULL when unpublished) |

The **PK is composite `(proj_id, class_name)`** because `class_name` `"main"` is
not unique across funds. The **`ticker` carries the `UNIQUE` index** and is the
single id that `holdings`, search, and the NAV chart key on. It is **derived**:
the parent's `abbr_name` when the SEC class is `"main"` (single-class funds), else
the class code itself (e.g. `MDIVA-A`). Because `ticker` is the cache-key tail of
`${source}:${ticker}`, each share class resolves to its own NAV/quote rows in
`fund_quotes`/`nav_history`.

Rows are populated by the same SEC general-info/profiles enumeration that builds
the catalog, de-duped per class — **no extra API calls**. Queries live in
[lib/db/queries/share-classes.ts](../../lib/db/queries/share-classes.ts)
(`upsertShareClasses`, `listShareClassesByProj`, `getShareClassByTicker`);
[lib/market/share-class-select.ts](../../lib/market/share-class-select.ts)'s
`pickDefaultClass` chooses the default class (retail-first, then accumulating).
Why parent and class are split: [explanation/architecture.md § Market data](../explanation/architecture.md#market-data).

### Chat & memory

| Table | Holds | Key columns / notes |
|---|---|---|
| `chat_threads` | One row per conversation | `status` (`active`/`idle`/`archived`), `archived_at`, `deleted_at` (30-day trash), `extracted_through_id` (extraction watermark) |
| `chat_messages` | Turns within a thread | `thread_id` (FK, cascade), `role`, `content`, `tool_call_id`, `feedback` |
| `user_preferences` | Long-term memory | **Bitemporal** — see below |

The `user_preferences` table is bitemporal: an update inserts a new row and
end-dates the old one (`valid_until`), never mutating in place; the active set
is `WHERE valid_until IS NULL`. Columns include `category` (enum:
`profile`/`finance_context`/`response_style`/`fact`), `source`
(`user_tool`/`advisor_tool`/`extracted`), `confidence`, and provenance
(`source_session_id`, `source_turn_ids`). Full design:
[features/memory.md](../explanation/memory.md).

### Auth (better-auth)

`user`, `session`, `account`, `verification`, and `passkey`. Names match
better-auth's defaults so its Drizzle adapter resolves them without a mapping.
These timestamps are stored as integer epoch-ms (app tables use ISO-8601 text).

### Multi-user metering

| Table | Holds | Key columns / notes |
|---|---|---|
| `usage` | Per-user daily token usage | Composite PK (`user_id`, `date`); `input_tokens`, `output_tokens` |
| `account_tier` | Per-user tier gating | `tier` (`free`/`trusted`); free is pinned to the free model chain in code |

## Ownership & multi-user

Most app tables carry a nullable `user_id` referencing `user.id`. Today, in
single-owner mode, it is `NULL` and rows are visible to the owner; multi-user
mode scopes every query by `user_id`. The evolution is described in
[design principles § single-owner → multi-user](../explanation/design-principles.md#from-single-owner-to-multi-user).

## Relationships (sketch)

```text
user ──< buckets ──< holdings
user ──< plans
user ──< journal_entries
user ──< model_portfolios
user ──< chat_threads ──< chat_messages
                       └─ user_preferences.source_session_id (provenance)
user ──< usage
user ──1 account_tier
holdings.quote_source ──▶ market registry ──▶ fund_quotes / nav_history
```
