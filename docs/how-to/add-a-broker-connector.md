# Add a broker connector

Point the "Connect your broker" feature at a new broker by writing a **connector
manifest** — a single JSON file describing the broker's API. No app code changes:
the collector (which runs on the broker's page) and the parser (which turns the
export into ledger rows) are fully generic and driven by the manifest's `shape`.
The brand and endpoints stay out of this repo — they live only in your manifest.

> **Before you start:** a connector reads your own broker account through the
> broker's own API, using your existing logged-in session. Keep real manifests
> out of version control (they're gitignored under `.connectors/`).

## 1. Capture the broker's API

Log in to the broker in your browser, open the order-history page, and watch the
**Network** tab (XHR/fetch). You're looking for three JSON endpoints:

| Endpoint | Returns | Manifest field |
|---|---|---|
| **Plan / portfolio list** | the customer's accounts/portfolios | `planPath` |
| **Order history** | one account's completed orders (cursor- or date-range-paged) | `historyPath` |
| **Pending orders** | one account's not-yet-settled orders | `pendingPath` *(optional)* |

Note the **host** they're served from, the query parameter that selects an
account, and the cursor/paging fields. Record the JSON **field paths** for
everything in [step 3](#3-map-the-response-shape).

Two things to check up front, because they decide whether you need the
[`transport`](#header-auth--cross-origin-apis) block:

- **Where the data API lives.** If the JSON comes from the **same host** as the
  page and rides your **session cookies**, the defaults work as-is. If it's a
  **different origin** (e.g. the page is `app.broker.com` but XHRs hit
  `api.broker.com`) and/or authenticates with **request headers** (an
  `Authorization` bearer / `x-api-key`) the page holds in memory rather than a
  cookie, set `transport`.
- **No pending endpoint?** Omit `pendingPath` — the collector skips that fetch.

## 2. Write the manifest skeleton

Copy [`.connectors/example.json`](../../.connectors/example.json) to
`.connectors/<broker>.json` and fill the location fields:

```jsonc
{
  "id": "acme",
  "displayName": "Acme Securities",       // shown in the UI
  "host": "trade.acme.com",               // collector must run here
  "planPath": "/api/portfolios",
  "historyPath": "/api/orders/history",
  "pendingPath": "/api/orders/pending",
  "openUrl": "https://trade.acme.com/orders/history",  // "Open broker" link
  "loginUrl": "https://acme.com/login",   // first-time login start (optional)
  "sourceTag": "acme"                     // stamped on every imported row
}
```

Then set `BROKER_CONNECTOR_PATH=.connectors/acme.json` (or host the JSON and use
`BROKER_CONNECTOR_URL`). See the [configuration reference](../reference/configuration.md#one-click-broker-import).

To run **several brokers** side by side, pass a comma-separated list
(`BROKER_CONNECTOR_PATH=.connectors/acme.json,.connectors/other.json`, or the
same for `BROKER_CONNECTOR_URL`). The Connect wizard then shows a broker picker
and Settings → Connections groups synced accounts per broker; each broker's rows
are tagged with its own `sourceTag`. There's still just **one userscript to
install** — it `@match`es every configured broker's host and resolves which
connector applies at run time from the page's hostname (`/runtime?host=`).

If the broker's responses happen to match the built-in defaults (the reference
shape in `example.json`), you're **done** — skip step 3.

## 3. Map the response shape

Add a `shape` object so the generic collector/parser can read *your* broker's
field names. **Every field is optional** — omit one to fall back to the built-in
default. Dot-paths (`"data.accounts"`, `"fund.code"`) read nested objects
everywhere — including `order` fields like `ticker`; an `order` field may also be
an array of candidates (first present wins).

```jsonc
"shape": {
  // ── Transport (omit entirely for a same-origin cookie API) ──
  "transport": {
    "apiBase":        "https://api.broker.com",   // prefixed to plan/history/pending paths
    "credentials":    "omit",                     // "include" (cookies, default) | "omit" (header auth)
    "captureHeaders": ["authorization", "x-api-key"]  // see "Header auth" below
  },
  // ── Collector (runs in the broker page) ──
  "plan": {
    "accountsPath": "data.accounts",   // where the account array lives in the plan response
    "accountCode":  "account_id",      // per-account: its stable code
    "accountName":  "account_name",    // per-account: human label → becomes the portfolio name
    "accountType":  "account_type",
    "labelPaths":   ["data.customer_name", "data.email"]  // login identifier (first found)
  },
  "history": {
    "mode":           "cursor",                // "cursor" (default) | "dateRange"
    "accountParam":   "account_code",          // query param selecting the account
    "cursorParam":    "cursor",                // query param carrying the page cursor
    "itemsPath":      "data",                  // array of orders in the response
    "nextCursorPath": "pagination.next_cursor",
    "hasNextPath":    "pagination.has_next",
    "maxPages":       200,                      // pagination safety cap
    // dateRange mode only — one bounded request (no cursor); end is "now":
    "startParam":     "startedAt",
    "endParam":       "endedAt",
    "startValue":     "2010-01-01T00:00:00+07:00",  // ISO floor for the range start
    "extraQuery":     "sortType=d&status="          // appended verbatim
  },
  "pending": { "accountParam": "account_code", "itemsPath": "data" },  // omit if no pending endpoint

  // ── Parser (turns each order into ledger rows) ──
  "order": {
    "type":           "order_type",   // buy / sell / switch / dividend
    "ticker":         "fund_name",
    "status":         "status",
    "tradeDate":      "trade_date",
    "amount":         "net_transaction_amount",
    "units":          ["net_transaction_unit", "unit"],
    "dividendAmount": ["amount", "net_transaction_amount"],
    "ref":            "ref",           // stable per-order id → dedup anchor
    "switch": {                        // a switch becomes a sell of the source + a buy of the target
      "toTicker": "sw_to_fund",
      "inAmount": "sw_in_net_transaction_amount",
      "inUnits":  "sw_in_net_transaction_unit"
    }
  },
  "values": {                          // how the broker spells each status/type (case-insensitive)
    "success":  ["SUCCESS", "COMPLETE"],
    "cancel":   ["CANCEL", "CANCELLED"],
    "pending":  ["PENDING"],
    "buy":      ["buy"],
    "sell":     ["sell"],
    "switch":   ["switch"],
    "dividend": ["dividend"]
  }
}
```

How the SDK uses these:

- **Routing.** Each `accountCode` becomes its own portfolio, named from
  `accountName` on first sight; the user can remap/merge later in
  **Settings → Connections**.
- **Dedup.** `sourceTag:accountCode:ref` is the stable id, so re-syncs add only
  new orders. If `ref` is absent the SDK falls back to a content hash and warns.
- **Kinds.** Only `success` orders import; `cancel`/`pending` and unrecognized
  types are counted but skipped. A `switch` expands into two rows (sell-out +
  buy-in) sharing the ref with `:out`/`:in` suffixes.

### Header auth & cross-origin APIs

When the data API is on a **different origin** and authenticates with **request
headers the page only holds in memory** (common in SPA brokers), cookies can't
reach it. Set `transport.captureHeaders` to the header names the broker's own
requests carry. The loader then:

- installs a hook (via `unsafeWindow`, at `document-start`) that records those
  headers off the **app's own** calls to `apiBase` — nothing is guessed or
  stored; the value never leaves the browser, and never reaches Macrotide;
- waits (up to ~15s) for the page to make an authed request, then replays the
  captured headers on its own calls with `credentials: "omit"`.

This needs a userscript manager that exposes `unsafeWindow` (Tampermonkey,
Violentmonkey — the recommended ones do). The collector reaches `apiBase`
cross-origin via the page's `fetch` (CORS), so the broker's CORS policy must
already allow the page origin — which it does, since the app makes the same
calls.

### Date-range history

Some brokers return the whole order history bounded by a date range instead of a
cursor. Set `history.mode: "dateRange"` with `startParam`/`endParam` and a
`startValue` (the ISO floor; the end is filled with "now" at collection time).
`extraQuery` is appended verbatim for any fixed filter params.

## 4. Test it

Add a fixture for your shape to the SDK's test (mirror the genericity block in
[`packages/connector-sdk/src/sdk.test.ts`](../../packages/connector-sdk/src/sdk.test.ts) —
a synthetic export with your field names, asserting the parsed rows) and run:

```bash
npm test -- packages/connector-sdk     # parser + collector emit
```

Then install the userscript (the Connect wizard's install link) and run it once
on the broker's order page — a first real sync proves the live shape end-to-end.
Re-running should report **0 inserted** (everything deduped).

## Updating a connector

The installed userscript is a **thin loader**: on every run it fetches the live
endpoints + shape from `GET /api/import/broker/runtime` (authenticated by the
user's import token in a header). So changing a manifest's **endpoints or shape**
takes effect on the next sync with **no reinstall** — just edit the manifest (or
the JSON behind `BROKER_CONNECTOR_URL`).

The one exception is the collector's **gather algorithm** itself (the code in
`packages/connector-sdk/src/collector.ts`). It lives in the installed loader, so a
change there is gated by `COLLECTOR_PROTOCOL_VERSION`: bump it when the algorithm
changes in a way that needs a new script. The bump drives the served userscript's
`@version` (`1.0.${COLLECTOR_PROTOCOL_VERSION}`), so a userscript manager that
honors `@updateURL`/`@downloadURL` **auto-updates** the loader on its next update
poll — no user action. As a fallback for managers whose auto-update is unreliable
(e.g. Userscripts on Safari/iOS), the loader also self-detects: seeing the runtime
endpoint report a newer version than the one it was built with, it toasts the user
to update from **Settings → Connections**. Plain shape/endpoint edits don't need a
bump.

## Where things live

- Generic SDK (no broker identity): [`packages/connector-sdk/`](../../packages/connector-sdk)
  — `types.ts` (the `ConnectorShape` contract), `parser.ts`, `collector.ts`.
- Manifest loader (server-only): [`lib/portfolio/connector.ts`](../../lib/portfolio/connector.ts).
- Your manifest: `.connectors/<broker>.json` (gitignored). For a shared deploy,
  host it privately and use `BROKER_CONNECTOR_URL`.
