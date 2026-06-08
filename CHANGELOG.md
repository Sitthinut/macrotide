# Changelog

All notable changes to Macrotide are recorded here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries describe
shipped **capability** (not phase numbers — those go stale). Forward-looking
plans live on the [GitHub Project board](https://github.com/users/Sitthinut/projects/2).

Macrotide has not cut a release yet, so everything to date sits under
`[Unreleased]` as **Added** — there's no prior released version to mark things
`Changed`/`Fixed`/`Removed` against. The first public launch will be the first
cut: this section is sliced into a dated/versioned heading and a fresh
`[Unreleased]` starts above it, at which point those categories come into play.

## [Unreleased]

### Added

- **History/Position "Invested" now shows the cost basis of money still invested**
  — the remaining cost of held units (deducting the cost of what you've sold, not
  its proceeds) — so the KPI card and the Advisor's spoken figure reflect capital
  actually still at work, without double-counting realized gains already in the
  "Realized" card.
- **Consistent Advisor header controls.** The hamburger, New-chat, and overflow
  (kebab) buttons now share one compact style across the mobile chat header, the
  Chats list, and the desktop panel; the desktop chat header gains a top-right
  New-chat button beside the close button, so a fresh conversation is one click
  from the chat view.
- **One-click import of your broker's full order history — now an ongoing sync.**
  The Add sheet can pull every buy / sell / switch / dividend across all of your
  broker portfolios with no file export or screenshots. Install a small userscript
  (one click from a `.user.js` link) and it runs on your broker's own (logged-in)
  page, collects the order history through the broker's API, and posts it straight
  back to Macrotide — so opening your broker keeps Macrotide in sync without even
  having Macrotide open. The installed script is a thin loader that fetches its
  broker settings from Macrotide on each run, so it **stays current without
  reinstalling** when the broker's API details change — only a change to the
  collection logic itself prompts a one-tap reinstall. Re-syncs are
  **idempotent**: each order carries a stable id, so importing again adds only
  genuinely new orders and never duplicates. A
  switch is recorded as a sell of the outgoing fund plus a buy of the incoming
  one; dividends become cash income; cancelled and pending orders are skipped.
  Which broker this targets is deployment config (env-only): a self-hoster points
  it at any broker by writing a **connector manifest** — a data-only JSON naming
  the broker's endpoints and (optionally) mapping its response field shape — with
  no code changes, so the feature is hidden unless configured and the repo carries
  no broker identity. A guided,
  platform-aware install stepper (with a QR for installing on your phone) walks
  you through it. Each of your broker accounts becomes its own portfolio, named
  after the plan — and in **Settings → Connections** you can remap an account to a
  different portfolio, merge several accounts into one, see each account's last
  sync, unlink (keeping or removing its history), and reset the import token.
- **Performance charts show the return for the selected period.** The portfolio
  performance chart and the fund-detail price/size chart now display a colored
  %-return for whatever range is selected (green up / red down) — derived from the
  first and last value in the visible window, so it updates as you switch
  1M/3M/6M/1Y/All. On the portfolio chart it replaces the old value-span readout;
  on the fund chart it reads as "{range} return" under the pills.
- **Performance-chart x-axis is readable across years.** The interactive chart's
  date labels no longer clip at the left/right edges, and the axis now groups by
  month: the first tick of each month shows a brighter `MMM 'yy` (e.g. `May '26`)
  while in-between ticks show a muted day number — so multi-year ranges (1Y / All)
  are unambiguous. The hover tooltip shows the full date with year.
- **Holdings get distinct, on-brand swatch colors automatically.** Each holding's
  dot is now derived from its **risk** along one ordered palette — cool/calm blue
  for the lowest-risk funds through to warm/hot red for the highest — so a glance
  across your holdings reads as a risk heat map. The color follows the SEC risk
  spectrum (RS1…RS8, with RS81 "8+" hottest of all) when known, and falls back to
  the holding's asset class otherwise; a ticker hash nudges lightness so same-risk
  holdings stay distinguishable. Colors are computed at render time and never
  stored, so they stay consistent and need no picker. (The SEC risk-spectrum code
  is now kept in the fund catalog to drive this, instead of being discarded after
  it's used to classify a fund's asset class.)
- **Portfolio chart cards align by row.** On desktop the charts grid sizes every
  card in a row to the tallest card in that row, while different rows size
  independently; on mobile (one column) each card sizes to its own content.
- **Known fund metadata now reads from the catalog source of truth.** Ledger
  imports still promote known catalog symbols to the Thai mutual-fund price
  source, but names, asset class, region, category, and TER are overlaid from
  `market.db` at read time instead of copied into `app.db.holdings`; custom
  holdings keep their user-entered metadata and unresolved asset classes stay
  unknown rather than defaulting to Stocks.
- **One Add surface records everything in your portfolio.** A single Add modal
  replaces the old separate holdings / activity / transaction sheets. Each row
  carries its own **Type**, auto-detected from what you paste or import: a
  **Balance** (a starting balance or a later restatement of what you hold now) or
  a trade (buy / sell / dividend / fee / split / reinvest). Intake is one calm
  surface — paste rows, drop a screenshot or CSV, or add a row by hand — feeding
  one editable review list of native-style rows you can open and edit inline
  before saving. A symbol field autocompletes against the known-fund catalog, and
  a quantity switcher lets you enter either **Units** or a **฿ Total** (units are
  derived from the price), matching Thai broker apps that show value rather than
  unit count. The Add modal and the History editor now share one validity gate, so
  they accept and reject every balance/trade combination identically — including
  cash-only dividends and fees on a self-priced custom asset, which can now be
  recorded with just a ฿ amount.
- **A full-screen History view and a per-fund Position page.** History reads the
  whole ledger as a money story — recent activity, balances grouped under their
  own header, and KPI cards (Return · Invested · Realized · Income) — and every
  ledger row is editable inline with the same grid the Add modal uses. Tapping a
  holding opens its Position page: that fund's own analytics (its return,
  invested, realized, and income), scoped to its events alone.
- **Advisor can speak to your realized P/L and money-weighted return.** The
  Advisor's portfolio read now includes the same lifetime ledger figures the
  History and Position screens show — money invested, realized gains, income, and
  money-weighted (annualized) return — and can scope them to a single fund, so it
  answers "what's my realized P/L?" or "my return on fund X?" from real numbers.
  It also knows which holdings are custom (self-priced) and treats that price as
  user-supplied rather than live market truth, nudging you to refresh it if stale.
- **Custom assets you price yourself.** A holding with no live NAV provider
  (crypto, a private fund, anything off-catalog) can be a **custom** asset:
  you record its current price, and the app values it from the latest price in
  its own ledger — a Balance's *current price* field or a trade's execution
  price. An unrecognized symbol now defaults to custom rather than assuming a
  market feed that returns nothing. If you later edit a custom holding's symbol
  to one the catalog tracks, it offers to adopt the official fund details and
  switch to the live NAV, keeping your units and cost.
- **Known funds keep their canonical details.** When a holding's symbol matches a
  fund in the catalog, its name, asset class, category, tax wrapper, and TER come
  from there and are locked — only its Portfolio and price Source stay editable —
  so catalog facts can't be overwritten by hand. Custom assets stay fully
  editable.
- **A clearer action menu on each holding.** A ⋮ menu (View history · Edit
  holding) replaces the ambiguous pencil on holding rows and the fund detail
  view, so each action is labelled. Deleting a fund lives inside its Edit form,
  where its destructive effect — removing the fund's whole ledger — is explicit.
- **Recording your holdings again doesn't double-count.** The first Balance you
  record for a fund is its starting balance; any later Balance for the same fund
  is treated as a restatement, which re-bases your units without re-counting the
  money as a fresh contribution. A Balance contributes only the **change** in cost
  basis since the last one — so it captures money you added between balances,
  reads a pure price move as zero new money, and never inflates your invested
  total. Whether a Balance is a starting balance or a restatement is decided by
  what came before it, so deleting one self-heals the rest.
- **The ledger keeps the figure you saw; unit counts and cost self-correct.** When
  you record a Balance by its ฿ value, or a buy/sell by its ฿ amount, that money
  figure is stored as the fact; the unit count is derived from the NAV on that date
  whenever your position is read, never frozen at save. A trade now works **from
  either side** — give a buy/sell its unit count *or* its ฿ amount and the other is
  filled from the NAV on its date (a unit-only trade needs a priceable fund), so you
  can record "bought 50 units" without hunting down what you paid. So if that date's NAV
  arrives late or is later corrected, your units — and the value, gains, and return
  that flow from them — recompute to match, with no re-entry. The same now holds for
  **cost**: a value-only Balance that carries an invested ฿ total (an import showing
  value & P/L, or a cost total) stores that *total* as the fact and derives the
  *per-unit* average cost at the fold — it no longer freezes a per-unit cost computed
  from a NAV-derived unit count. A costed Balance's invested cash also reaches your
  money-weighted return however you entered it (by units or by ฿ total). And a
  value-only Balance the app can't price yet (no NAV on file for its date) no longer
  blanks an existing position — it's held aside and appears when that date's NAV lands.
  This holds for **every fund regardless of how its fund code is capitalized**: the
  NAV lookup normalizes the fund-code case, so a fund cataloged in lowercase derives
  its units and value exactly like one in uppercase (previously such a fund's
  value-only Balance found no NAV and silently dropped from your holdings).
  Your **holdings list itself now folds the ledger on every read** (not just the
  analytics), so units, cost, value, and weight always reflect the latest NAV with no
  refresh — the holdings view and the return figures can never drift apart. The
  `holdings` table no longer stores units or average cost at all (those columns are
  dropped); a holding row now carries only the instrument metadata that isn't in the
  ledger, so there is no derived figure left to go stale.
- **One catalog drives both the symbol suggestions and the price-source badge.** The
  autocomplete and the source badge now resolve from a single authority — the real
  fund catalog (plus the funds you already hold) — so they can never disagree. A
  symbol the catalog knows reads as a Thai fund; anything it doesn't is a **custom**
  (self-priced) asset. There's no shape guessing (a hyphenated code is no longer
  assumed to be a fund) and no hard-coded ticker list; when stocks/ETFs join the
  catalog they'll resolve the same way. You can still flip the badge per row. (Fixed
  along the way: catalog tickers stored lowercase — e.g. some SSF funds — were wrongly
  read as custom; the lookup is now case-insensitive.)
- **Record by ฿ amount — no unit count needed.** Thai broker apps show what a
  holding is worth, not how many units you hold, so a **Balance** now accepts the ฿
  value and a **buy/sell** accepts the ฿ amount; the app derives the units. It
  prices off the price on the row's **own date** — the row's execution / current
  price, else the fund's NAV on that date, never today's moving NAV — so a past
  entry doesn't drift; an entry dated today uses the latest NAV. The divisor is
  always a current price, never your average cost, so value and cost can't be
  conflated. A ฿-total typed in the Add modal persists through collapse/expand. If
  a fund has no price on file for the date, the app keeps your figure rather than
  inventing units — a Balance asks for a unit count; a trade saves and flags it.
- **Explore's browse list ranks each share class on its own fee.** The default
  (no-search) screener now sorts by each priceable class's *own* TER — cheapest
  first — instead of grouping a fund's classes together under the family's cheapest
  class. Previously an expensive class (e.g. a 0.53% retail class) could ride into
  the top alongside a fee-waived sibling; now every row sits at the fee it shows.
  Equal TERs break by fund size then retail-before-restricted. Search is unchanged
  (still relevance-first, with the exact-ticker match floated to the top).
- **Explore's cheapest-first ordering no longer trusts a fee-waived class.** A
  multi-class fund publishes one total-expense figure per class; the screener's
  fund-level TER could latch onto a near-zero special class (e.g. a fee-waived
  `-X`) and brand the whole family with a fee no retail buyer pays, floating it to
  #1 while the row showed the real ~2% retail fee. The fund-level TER now follows
  the class the screener actually leads with — retail over restricted, never an
  institutional/insurance class — so the default list ranks on what you'd pay.
- **The Cash filter in Explore returns money-market funds.** Money-market funds
  were classified as bond because the SEC's coarse `policy_desc` has no
  money-market value, leaving the Cash filter permanently empty. They're now
  recognized from the SEC risk-spectrum code (RS1/RS2 = money market), with the
  fund-name match (Thai `ตลาดเงิน` / English "money market") as a fallback, and
  bucketed as cash-equivalents. (See the risk-spectrum classification note under
  *Changed*.)
- **Explore stops surfacing funds you can't buy.** Funds the SEC marks not-for-retail
  (`proj_retail_type` ≠ `R` — accredited / institutional-only private funds whose
  class detail describes hedging, not audience) are now hidden from the screener,
  and a zero TER is treated as "no published fee" (sorted last, not the cheapest) so
  those funds no longer top the default list.
- **Explore handles non-public share classes correctly.** Provident-fund /
  private-fund / special-group classes are now identified and **down-ranked**
  below retail classes (kept visible — they're investable in principle), while
  unit-linked **insurance** classes are hidden (bought through a policy, not
  directly). General-public availability takes precedence, so a class offered to
  both the public and an insurance channel stays retail. Previously these all fell
  through as unclassified and could top the rankings.
- **Explore search finds share-class tickers, and families rank by popularity.**
  Typing a specific class code (e.g. a multi-class fund's accumulating or dividend
  class) now finds its fund instead of returning nothing — the search index covers
  class tickers, not just parent names. Within a fund, classes are ordered
  most-popular-first by fund size (per-class AUM), an exact ticker match is floated
  to the top, and a deterministic flagship heuristic (retail → primary →
  accumulating) fills in until AUM is warmed.
- **Market data now refreshes on a schedule, and Explore reads deep history
  instantly.** Two background jobs ride the systemd-timer scheduler. A daily
  *freshness* refresh pulls NAV for held positions and tracked indicators, so
  charts (and the unattended digest) are current without anyone opening the app.
  An all-funds NAV + fund-size *pre-warm* crawler fills deep price history for the
  whole registered-fund catalog, so the screener's price / 1-year-return / size
  columns and a cold fund-detail open render immediately instead of fetching on
  first view. Both are idempotent `npm run jobs:*` scripts; the firing mechanism
  is systemd timers, not in-process cron (see the
  [decisions log](docs/explanation/decisions/README.md#picks) + deploy.md).
- **Refreshed sign-in & Account UI.** The login screen leads with "Continue with
  Google" / "Continue with passkey" (each with its provider icon), a quiet
  "Create account" link, and the demo below a divider. Account settings shows all
  sign-in methods in one section (passkeys with per-credential add/remove over
  the linked-provider row), an editable name, and an account email that appears
  only when verified. One shared input radius app-wide.
- **Passkey and Google are now peer sign-in methods, and accounts can't be
  pre-hijacked.** Creating an account with a passkey asks only for your name — no
  email — so no one can register an account at an address they don't control
  (closing both account-takeover and email-squatting). You can start with either
  method and add the other later from Account settings (Link/Unlink providers,
  add/remove passkeys, edit your name), with a guard that always keeps at least
  one working way to sign in — including when you signed up with a provider and
  added a passkey. Your account email mirrors your linked provider: linking
  adopts its verified address, and unlinking your last provider clears it back to
  emailless. The post-sign-in "add a passkey" offer appears only when you don't
  have one yet, and not again once dismissed. Rationale: ADR 0001.
- **Explore and fund detail now work at the share-class level.** A fund's
  priceable share classes are catalogued separately from the parent fund, so
  fees, tax wrapper, distribution policy, ISIN, and NAV are tracked per class.
  Explore lists priceable classes (hiding institutional/insurance classes by
  default), each showing its per-class fee and trailing 1-year return; the fund
  detail offers a class selector that defaults to the retail, accumulating class.
  The classes are gathered in the same SEC crawl as the catalog, with no extra
  API calls.
- **Fund detail now charts its history.** Opening a fund in Explore shows a
  history chart sourced from the cached daily series, with a range selector
  (1M / 3M / 6M / 1Y / All) and a Price / Fund-size (AUM) toggle — read how a
  fund has moved and grown before adding it; the price tooltip also reads the
  cumulative return since the window start. The fund's net assets ride along in
  the same SEC NAV row, so AUM costs no extra fetch. Funds with no cached history
  yet show a graceful empty state.
- **Charts now deepen their own history on demand.** Asking for a longer range
  than the cache holds (e.g. "All" on a fund only ever fetched at six months)
  now re-fetches the full series even while the quote is still fresh, instead of
  showing a truncated window. The market cache records the deepest range fetched
  per symbol and never prunes stored history by age.
- **The fund portfolio table now reads by security and groups by asset type.**
  Each holding leads with its own identifier — the ticker for listed securities
  (e.g. "EWT US"), the issuer for a bank deposit — instead of the SEC's generic
  category text, so distinct ETFs no longer look like duplicate rows. The
  holdings are grouped under a per-category subheader (with the category's summed
  weight) shown once, rather than repeating the category on every row; the
  biggest exposure leads. FX-forward ladders and bond tranches still collapse to
  an expandable net row within their group.
- **Advisor replies now render as Markdown.** The Advisor returns Markdown, and
  the chat now renders it — headings, bold, lists, inline code, code blocks, and
  GFM tables show as formatted text styled to the app's design tokens (tables
  match the in-chat holdings table) instead of raw `**markup**`. Rendering streams
  incrementally as the reply arrives. Only Advisor bubbles are rendered; what you
  type stays plain text. The renderer is sanitized — no raw HTML passes through
  and unsafe link protocols are stripped — so untrusted model output can't inject
  active content.
- **The chat now uses the app's overlay scrollbar.** The Advisor message stream
  scrolls with the same thin, auto-hiding overlay scrollbar as the rest of the
  app (main column, side panels, thread list) instead of the browser's native
  bar, on desktop/tablet; touch keeps the native scrollbar.
- **One unified ledger — your holdings are a projection of your transactions.**
  A single event ledger is the source of truth for positions; the holdings list
  is derived from it and rebuilt on every write, so "what you hold now" and "how
  you got here" can never contradict each other (there is nothing to reconcile).
  The ledger has DELTAS (buy/sell/dividend/fee/split/reinvest) and ANCHORS —
  `opening` (a starting balance) and `snapshot` (a point-in-time restatement) —
  supporting three flows: enter full history, start from an opening balance then
  track forward, or just periodically restate what you hold. One **Add** modal
  records all of it — anchors (shown as a "Balance") and trades sit on the same
  surface, each row's type set per row (see *One Add surface*, above). A
  full-screen **History** view and per-fund **Position** pages read the ledger
  back, and every row is inline-editable — edit, add, or delete in place, with
  balances grouped under their own header and a fund's delete guarded (it removes
  that fund's whole ledger). Editing a holding edits its backing event (or
  records a restatement). From the ledger, History and Position show realized
  gains (average-cost, FIFO available), money-weighted return (XIRR, in THB, once
  there's enough history and a current price), and a cost-basis timeline. A
  position entered without an average cost degrades gracefully — value and
  allocation still work; gains/return show a quiet "add cost" nudge rather than a
  fabricated figure. Design:
  docs/explanation/decisions/0004-unified-ledger-positions-derived.md.
- **The Portfolio screen leads with plain-language checks instead of a 0–100
  grade.** The single composite health score is gone from the screen — a
  chase-able grade nudges the checking-and-tinkering that measurably hurts
  passive index investors. In its place: the "one thing that matters now"
  headline, then four named checks (drift, fees, diversification, cash), each a
  certain value + a status (on track / watch / act) + a one-line reason; the
  charts are the drill-down. Drift with no target reads as a "set a target"
  prompt rather than a failing mark, and holdings whose fee isn't published read
  "not published" rather than a misleading 0%.
- **The diversification check now sees through your funds.** Instead of a
  fund-count diversification index — which punished a clean two-fund index book
  and was fooled by several funds tracking the same index — diversification
  measures *underlying* concentration: the largest single company across all
  your funds (a lower bound, shown as "at least …", since most funds publish
  only a top-5), plus detection of funds that are effectively the same exposure.
  It is coverage-gated and asymmetric — it can flag concentration where holdings
  data exists but never certifies diversification it can't see — and a large
  single *alternative* position is flagged while a large broad-index equity fund
  is not. The composite score is kept for the Advisor's internal use and
  /api/analysis. Rationale + sources: docs/explanation/portfolio-health.md.
- **The Advisor can now see images you attach in chat.** Drop or paste one or
  more screenshots into the chat composer and the Advisor reasons over them
  directly — reconciling a portfolio summary, a transaction history, and
  per-holding detail screens into one set of positions, deriving missing
  units/average cost where the data supports it and asking for anything it can't
  read. When it extracts two or more holdings it shows a compact in-chat table
  that opens the full importer pre-filled for bulk review and save; a single
  position still uses the one-tap add card. You can also ask about a chart or
  factsheet image and get a plain-language answer. Image turns route to a
  dedicated vision model (`VISION_CHAT_MODEL`, default `google/gemini-2.5-flash`;
  set it to `off` to disable); free-tier vision is bounded by the existing daily
  token/cost caps, and demo image upload is off unless an operator sets
  `DEMO_VISION`. Attached images are sent to the vision provider to answer the
  turn and cached only in your browser for the session — never stored on the
  server (the saved message keeps a "[N image(s) attached]" marker). A message
  carries up to 10 images; picking more keeps the first 10 and says how many were
  skipped (rather than dropping them silently), and the chat route enforces the
  same cap. For a larger batch, Add holdings → Image has no per-message limit.
- **The fund detail tables now cue when they scroll sideways.** The
  horizontally-scrollable tables (Performance & Risk, Portfolio, Look-Through)
  fade their content out at whichever edge still hides columns — a subtle
  "more to scroll" hint that reads identically in light and dark (a pure
  opacity mask, no theme tint), and clears at each end. The scroll regions are
  also keyboard-focusable now.
- **The Portfolio performance caveat now reflects which lines actually exclude
  dividends.** The note under the total-balance graph adapts to whether a
  benchmark is selected and whether the book holds a dividend-paying fund,
  explaining that the index, the user's balance, or both understate real total
  return — and showing nothing when neither applies.
- **The demo portfolio chart now shows about five years of realistic history at
  every zoom.** In demo mode the Portfolio chart plots a dense multi-year curve
  for both the portfolio line and the benchmark overlay — daily detail for recent
  months (so 1M/3M/6M/1Y look real) and weekly further back, instead of the few
  months the live price crawl had warmed. The history is self-contained and
  offline at runtime: a committed fixture is built from real public index data
  (S&P 500, Nasdaq, Nikkei, SET, global equity, gold; Thai bonds and cash
  modelled), then each demo fund's series is derived from the index it tracks by
  applying its fee as a compounding drag plus a small deterministic tracking
  wobble, so funds visibly trail their index and the blended portfolio diverges
  from any single benchmark. Owner mode is unchanged — it still reads live market
  data. Regenerate the fixture with `npm run refresh:demo-history`.
- **The Portfolio fee-check section is info-only, with management on a dedicated
  "See details" page.** On the Portfolio tab the section reads as plain
  information cards — each held fund, its cheaper comparable alternative(s), and
  the annual saving — with exactly one section-level "Ask advisor" (a single
  fee-focused prompt scoped to the most material finding and its cheapest
  alternative) and a primary "See details" beneath it. The tab shows only the
  top 3 findings by largest annual saving — when more exist, the "See details"
  button carries the true total ("See all N") — while "See details" still lists
  all of them.
  There are no per-card actions on the tab. "See details" opens a full-screen page (a sub-view of Portfolio, not a
  new tab) that houses all the management UI: each fee check with its own Archive
  ("I've seen this; file it") and "Not for me" (reject, with an optional reason —
  four chips plus a free-text "Other…"), plus a "Hidden checks (N)" list to
  restore anything filed or rejected. Both choices are recorded per fund, survive
  reloads, and resurface only when the finding materially worsens: the reason a
  rejection carries selects how stubborn that is (a magnitude reason can return on
  a bigger jump; a preference or structural reason stays hidden), and a ratchet
  means nothing nags more than once per material jump. A "Not for me" also writes
  a Journal ▸ Feedback entry so the rejection — and its reason — is reviewable and
  feeds the Advisor's "don't repeat rejected advice" context. Suppression is
  applied server-side and is per-user (ephemeral in the demo), built on a reusable
  action-item layer the headline and rebalance suggestions can adopt later.
- **Tapping a holding now opens a read-only detail view instead of the edit
  form.** The Portfolio screen's holding rows open a "Holding detail" sheet that
  reuses the fund detail view — performance, allocation, top holdings, and feeder
  look-through when the position is a catalog fund (matched by its ticker). A
  holding that isn't in the catalog (a stock, index, or cash position) degrades
  to showing its own stored details rather than an error. Editing is now an
  explicit affordance: a pencil button on each editable row, and an Edit button
  inside the detail view, both opening the existing holding edit flow.

### Changed

- **Fund asset class (including Cash) is now driven by the SEC risk-spectrum, not
  name-matching.** Each fund's regulatory risk code from the SEC factsheet
  (RS1/RS2 → money market, RS3/RS4 → bond, RS6/RS7 → equity, RS8 → alternative)
  is the primary classification signal; the old `policy_desc` + money-market
  name-match is now only the fallback for the handful of funds without a risk
  code. This recovers money-market funds whose names omit "money market" (e.g.
  treasury / cash-management funds) and fills in asset classes the coarse
  `policy_desc` left blank — so the Cash filter and asset-class screening reflect
  what each fund actually is. Ambiguous risk codes (RS5, which mixes balanced and
  high-yield-bond funds; the complex RS8x codes) defer to the policy label.
- **The SEC fund crawl is now ELT (raw landing + a re-runnable transform).** The
  crawl lands verbatim SEC payloads in a new `sec_raw` table, then an API-free
  transform derives the `fund_catalog` + `fund_fees` columns from them. Re-deriving
  a field — a classification fix, a recovered column — is a seconds-long transform
  re-run (`npm run jobs:transform-catalog`) instead of an ~80-min re-crawl, and
  nothing fetched is discarded at land time. No change to the catalog data or any
  screen; this is the data-infrastructure foundation for SEC-native classification.

### Fixed

- **Importing a transaction history no longer records every row as a Balance.**
  The image importer now auto-detects whether a screenshot is a holdings
  snapshot (current positions → Balances) or a transaction history (a dated
  buy/sell log → trades) and routes it to the right reader; when it's not sure it
  asks you which it is instead of guessing. Works in both the Add-to-portfolio
  modal and Advisor chat (the Advisor gained a dedicated transaction-import path),
  so a dated buy/sell/switch log lands as trades, not opening balances. Both the
  importer and chat now feed the model the same higher-resolution image, and an
  image you attach in chat is read once and remembered as text — so the Advisor
  can keep discussing it across follow-up turns without asking you to upload it
  again, and Shift+Enter adds a newline in the chat box.
- **A fund with no published fee no longer reads as "0.00%".** The SEC feed
  reports a `0` expense rate two ways that don't mean "free": a new/IPO fund
  carries a fee ceiling but a `0` *actualized* rate until a period elapses, and a
  multi-class fund emits an all-zero `main` placeholder row beside its real
  classes. The TER derivation took those zeros at face value, so a 4.49%-ceiling
  fund showed 0.00% and could top the fee finder's cheapest-first ranking — and
  surface as an absurd "0.00% cheaper alternative" in the portfolio fee check. The
  derivation now treats a `0` rate as "not actualized": an unactualized rate falls
  through to the ceiling, and a fully dataless fee resolves to *no published fee*
  (sorted and excluded like a null) rather than a fake free fund. There is no
  genuinely 0% Thai fund — the feed can't even express one — so this only removes
  false zeros. Applies everywhere TER is read: the screener, the advisor, and the
  fee check.
- **The login screen no longer shows a bot-check under the social sign-in
  buttons.** OAuth sign-in starts a redirect to the provider, which authenticates
  the user — so the Turnstile gate (which protects direct account creation) no
  longer sits on or blocks the "Continue with Google" button. It now appears only
  on the passkey Create-account form, where an account is minted without a
  third-party identity check.
- **The Account screen's "Passkeys" status now reflects reality.** The status tag
  was hardcoded to "active"; an account that signed in with a social provider and
  skipped passkey setup has none, so it now reads "none" until a passkey is
  registered (it previously contradicted the "No passkeys registered yet" list
  directly below it).

- **Fund portfolio holdings no longer duplicate across nightly crawls.** The SEC
  feed sends a holding's reporting `period` as a number, which the incremental
  ingest stored as `"202406.0"` and then compared, as a string, against the
  incoming number — so the de-duplication guard never matched and every crawl
  re-inserted the entire portfolio. On the fund detail view this showed the same
  holding repeated several times and, because the display collapses same-security
  rows and sums their weight, inflated a holding's %NAV (e.g. a 19% position
  summing past 100%). Periods are now normalized to a clean `YYYYMM` string on
  both sides of the guard, so re-crawls are idempotent. A one-time cleanup script
  (`scripts/dedupe-fund-portfolio.mjs`) normalizes existing periods and removes
  the accumulated duplicate rows.
- **A restated reporting period no longer shows its holdings twice.** When the
  SEC re-publishes a fund's factsheet for a period it already reported (a
  restatement, identifiable by a newer `last_upd_date`), the pre-fix ingest had
  appended the whole second snapshot — so the period held two copies of every
  holding and the detail view summed them (e.g. a single ~100%-NAV master fund
  shown twice). The cleanup script now keeps only the latest snapshot per
  reporting period, dropping superseded re-publications; the quarterly history
  across distinct periods is preserved untouched.
  range window (1M/3M/6M/1Y) opened on a non-trading day, holdings with no price
  exactly on that date were missing from the first plotted point, so the chart
  started at a fraction of the real total and snapped up a day or two later. The
  value series now carries in each holding's most recent price from before the
  window to seed the first in-window date (without plotting any date earlier than
  the window start), and the benchmark overlay does the same — so every range
  starts with the full book and a complete benchmark line. Applies to both real
  accounts and the demo.
- **Switching screens now remembers where you were on each one.** Screens are
  swapped in place inside one persistent scroll container, which previously kept
  a single shared scroll offset across the swap — so opening the Templates view
  from the Portfolio screen inherited the Portfolio scroll position and appeared
  partway down. Each screen now keeps its own scroll position for the session:
  returning to a screen restores where you left it, and a screen not yet visited
  opens at the top. The memory is per-session — a full page reload starts every
  screen back at the top. The leaving screen's position is now tracked live while
  you scroll rather than read at teardown, so it survives the in-pane viewport
  clamping its offset when shorter content swaps in — fixing tablet/desktop, where
  returning to a tab previously landed at the top. Works on both the mobile
  (window) and tablet/desktop (in-pane) scroll roots.
- **Performance-vs-index now converts foreign holdings to baht before summing.**
  The portfolio value/return series previously added each holding's `units × NAV`
  across currencies (THB funds, USD ETFs, JPY indices) without conversion, then
  compared the result to a THB index — so for any book holding a foreign asset
  the return reflected the foreign price move, not the baht experience. Each
  holding's native currency is now inferred from its routing key and its value
  is converted to THB at that date's USD/THB (or cross) rate, using the existing
  ECB-backed FX source. A holding whose rate is unavailable is dropped from the
  total and flagged rather than mis-summed.
- **The benchmark line on the performance chart no longer disappears across
  trading calendars.** It was only drawn when the portfolio and benchmark series
  had identical lengths, which Thai and foreign calendars almost never produce;
  the two are now aligned by date and rebased to their first common point, so the
  benchmark renders whenever the data overlaps.
- **Added a method note to the performance-vs-index view** stating that values
  are converted to baht, that the comparison assumes the current holdings were
  held throughout the window (purchases and sales within it are not yet
  accounted for), and that benchmarks use price-return indices, which exclude
  dividends.
- Fee-creep now only suggests cheaper funds with the same exposure (region + asset class), not just the same broad asset class — so a global-equity fund is no longer offered a Thai/domestic-equity "alternative".
- **The portfolio score and its "why this score" breakdown now show for any book
  with holdings, even without a target model.** The breakdown card was previously
  hidden unless a target model was selected, so users tracking no plan never saw
  their score at all; it now renders whenever there are holdings and a score.
- **A portfolio with no target model no longer has its score inflated by an
  auto-awarded drift component.** Previously the drift component silently scored
  full marks when no target was set, rewarding the absence of a plan. Drift is now
  excluded from the composite when there's no target and the remaining components
  (fees, diversification, cash) are rescaled onto 0–100; the breakdown shows the
  drift row as "Not scored — set a target model" rather than a full mark.
- **Holdings with an unpublished expense ratio no longer inflate the fee score.**
  The blended fee was computed with unknown TERs treated as 0% (perfect), making a
  book with missing fee data look cheaper than it is. The blended rate is now
  weighted over holdings with a known TER only, and the fee component notes "fee
  data incomplete for N holdings" when any are missing — missing data neither
  helps nor hurts the score.

### Added

- **Advisor eval harness — a committed benchmark for the chat loop.**
  `scripts/eval/` promotes the throwaway model-trial script into a repeatable
  eval: a hermetic synthetic tool surface (`EXAMPLE-FUND-*`, never the live DB),
  two question tiers (retrieve-then-explain + complex multi-step), and a
  deterministic grader scoring each answer on grounded facts, right tool calls,
  and no invented holdings — plus dead-end rate, latency, tokens, and est cost.
  Run `npm run eval:advisor` before flipping `FREE_TIER_MODEL`, editing the
  system prompt, or tuning the reasoning gate. A token-free vitest
  (`tests/eval/`) guards its structure; the prompt is shared with the route via
  `lib/advisor/system-prompt.ts` so the benchmark can't drift from production.
  Grounded in a new prior-art survey
  ([research/agent-evals.md](./docs/explanation/research/agent-evals.md)) and
  written up as [inference-strategy.md § 7 Evaluation](./docs/explanation/inference-strategy.md):
  reports the metrics separately (dead-end rate, quality, `pass^k` reliability,
  and grounded-facts / tool-trace / no-hallucination sub-signals), grades against
  pre-declared per-tier thresholds (PASS/FAIL; `EVAL_GATE=on` exits non-zero), and
  tests negative cases (`mustNotCallTools` over-call guards). An LLM-as-judge
  layer is deliberately deferred until the deterministic floor demands it.

- **Eval harness rigor — uncertainty, grounding, refusal, and run diffing.**
  Builds on the eval harness so before/after comparisons are statistically honest
  and mechanical: quality is now reported with a **95% confidence interval** (so a
  gap that's only run-variance is visible), and `npm run eval:diff -- <before>
  <after>` compares two result files — per-question score deltas, `pass^k` flips,
  and a **paired McNemar significance test** over the shared question set. Each
  result file is tagged with its git SHA. The grader gained **argument grounding**
  (`expectToolArgs` — asserts a tool was called with the right inputs, not just by
  name), a **trajectory bound** (`maxSteps`/`minSteps` — a lookup that takes five
  generations is thrashing), and a **negative control** (an empty-holdings turn
  where the right answer is "you have no holdings yet" and naming a fund is a
  hallucination), so refusing is rewarded alongside answering. Runs persist each
  turn's step count and tool calls with their arguments for after-the-fact audit.
  All token-free, guarded by `tests/eval/`.

- **Tool-result shaping — compact model-facing tool outputs.**
  The heavy reads (`read_portfolio`, `read_performance`, `find_funds`,
  `find_cheaper_alternatives`) now expose a lean text view to the model via
  `toModelOutput` while the UI still gets the full object (proposal cards and
  fund lists unchanged). Keeps the headline facts (largest holding, drift, fee,
  the benchmark gap, each fund's TER), drops JSON scaffolding/HHI/ids — measured
  54–73% smaller per result. In the eval the retrieve tier went to zero
  dead-ends with higher quality. Shapers are pure (`lib/advisor/shape.ts`).

- **Reasoning-intent gate — reason only when it earns its cost.**
  A cheap deterministic classifier (`lib/advisor/intent.ts`) raises reasoning
  `effort` to `medium` on the owner/trusted paths only for genuine multi-step
  turns (rebalance, SSF-vs-RMF, plan-anchored tilt) and `none` otherwise;
  free/demo stay pinned `none` (cost-protected). Measured on the complex tier,
  `medium` lifted answer quality 78%→88% at ~3.5× latency — so paying it only on
  the turns that earn it is the win. `REASONING_GATE=off` restores model-default
  reasoning. See [inference-strategy.md §3](./docs/explanation/inference-strategy.md).

- **Inference-strategy docs — how the Advisor stays smart/fast/token-efficient.**
  A new design doc ([inference-strategy.md](./docs/explanation/inference-strategy.md))
  records the cost/latency/quality decisions for the Advisor — model routing &
  tiers, prompt-cache strategy, reasoning-token policy (with a "when should the
  Advisor reason?" decision table), context loading, and tool-result shaping —
  the principle behind each lever. It's backed by two new fact-checked prior-art
  surveys:
  [llm-platform-primitives.md](./docs/explanation/research/llm-platform-primitives.md)
  (how Anthropic/OpenAI/Gemini/OpenRouter expose tool calling, system prompts,
  reasoning tokens, citations & structured output) and
  [context-and-caching.md](./docs/explanation/research/context-and-caching.md)
  (prompt-caching cost/latency math + context-window management / progressive
  loading). The existing context-engineering survey had its flagged-unverified
  claims (Anthropic metrics, Hermes internals, iteration caps, LangGraph
  specifics) re-checked against primary sources and reworded.

- **Context-aware Ask-Advisor handoff — fewer tool round-trips.** The
  Ask-Advisor buttons now hand the Advisor a small structured **context
  envelope** (the screen, the intent, the subject in focus, and the figures the
  screen already computed) alongside the visible prompt, instead of burying it
  all in a sentence. The two high-value dashboard findings — *Plan the rebalance*
  (carries the tracking gap + target) and the fee-creep *Ask advisor* (carries
  the held fund, its TER, the cheaper alternative + its TER) — let the Advisor
  answer from those facts without re-deriving them via `read_portfolio`; the fund
  and model-strategy buttons tag the subject. The envelope is injected as a
  per-turn message **after** the cached system/memory prefix (never into it), so
  it can't invalidate prompt caching, and it's defensively parsed server-side.
  Plain typed turns and open-ended prompts are unchanged (the field is additive).
  The envelope reserves an `image` slot as the future home for in-chat vision.

- **Free tier can run a cheap paid model, bounded by a daily cost cap.** The
  free-tier chat model is now its own operator knob (`FREE_TIER_MODEL`, default
  the zero-cost `openrouter/free`) — set it to a cheap paid model (e.g.
  `google/gemini-2.5-flash`) to lift answer quality without touching the owner
  chain. It reads its OWN var, never `AI_MODELS`, so the long-standing "a free
  user can't be widened to a paid model by an owner-chain slip" invariant holds
  by construction. Spend stays bounded by two pre-request caps: the always-on
  daily **token** cap and a new optional daily **cost** cap in cents
  (`DAILY_CENTS_BUDGET_FREE`/`_TRUSTED`) — the right bound for a paid model with
  asymmetric input/output pricing. Per-turn cost is estimated from a
  `MODEL_PRICES` table (USD/Mtok) keyed on the model OpenRouter actually served;
  free/unpriced models contribute zero, so the cap is a no-op until you opt in.
  Owner mode stays uncapped.

- **Reasoning disabled on the cost-sensitive paths.** Free-tier, demo, and the
  ancillary title/extract calls now send `reasoning: { effort: "none" }` to
  OpenRouter, so a reasoning-capable model the router lands on doesn't silently
  burn hidden chain-of-thought (billed at the output rate, and measured at 8–29s
  vs ~2s per turn) on a chat turn that doesn't need it. Owner and trusted tiers
  keep their model-default reasoning — selectively raising effort for genuinely
  analytical asks is a planned, intent-gated follow-up. Non-reasoning models
  ignore the flag, so it's a safe no-op for them.

- **Reliable Advisor replies — no more "I didn't have a reply."** Free-tier chat
  turns that read a tool but stopped before writing an answer — or that hit an
  upstream provider error mid-turn — now recover automatically: the Advisor
  re-runs the final answer step with the data it already gathered, or retries
  once on an error, so a tool-using question lands a real reply instead of a
  dead-end. The recovery is model-agnostic (it doesn't depend on any single free
  model behaving), and applies across demo, free, and owner chat.

- **Context-aware Advisor starter prompts.** The chat composer's suggestion
  chips now reflect the user's actual portfolio and the screen they're on
  instead of a fixed list — surfacing prompts about a concentrated top holding,
  a cash drag, drift from the selected target model, or a high blended fee, and
  biasing toward the active screen (Markets, Explore, Models, Journal,
  Portfolio). A fresh or empty portfolio gracefully falls back to evergreen
  learning prompts.

- **Add holdings from a screenshot — structured import.** The Add-holdings
  **Image** tab now reads one or more broker screenshots into an **editable
  review table** shared with Paste/CSV and manual table entry, instead of
  dumping raw transcription text. Most Thai broker apps show market value +
  allocation %, not units — so where a fund's NAV is on file the importer
  derives units (`value ÷ NAV`) and average cost, marks them estimated, and
  highlights rows that still need quantity (open the fund's detail view for
  exact figures). Upload several images and the rows merge. Powered by a vision
  model (`OCR_MODEL`, default `google/gemini-2.5-flash`), validated on real Thai
  statements for faithful ฿/decimal reading; the screenshot is read once and
  never stored.

- **Confirm-before-delete on destructive actions** — deleting a holding,
  portfolio, or custom model template, purging a chat thread, removing a passkey,
  or signing out everywhere now routes through a consistent confirmation dialog
  (replacing native `window.confirm` and one unguarded one-click delete), so no
  irreversible action happens on a single mis-tap. The reversible 30-day chat
  trash and an ordinary sign-out stay one-tap.
- **Legal links on the front door** — the landing footer now links the Terms of
  Service and Privacy Policy pages.
- **Instant fund search** — the fund finder typeahead is backed by an in-memory
  MiniSearch index (`lib/search/fund-index.ts`): fuzzy + prefix matching, field
  boosting, and curated index-nickname synonyms. It folds each feeder fund's
  **master** fund name into the index, so a search for "S&P500" surfaces feeder
  funds like KKP US500-UH. Replaces the old `LIKE '%q%'` scan that couldn't use
  an index or match by master fund; lookups are sub-50ms.
- **Real index levels** — new EODHD and FMP market providers return the **actual**
  index level (S&P 500, Nasdaq-100, Dow, Nikkei, Thai SET) where a free real
  source exists, instead of an ETF proxy. Provider chain is FMP → EODHD → Twelve
  Data (ETF proxy) → Frankfurter (FX) → Yahoo, degrading gracefully to the prior
  proxy/Yahoo behaviour when keys are unset. MSCI ACWI stays an ETF proxy (no
  free real index) and gold stays XAU/USD. New env vars `EODHD_API_KEY` and
  `FMP_API_KEY` (both free-tier). This is the "reliable index/FX source (Yahoo
  429 fix)" the README listed as planned — Yahoo hard-429s datacenter
  IPs and the keyed providers resolve it.
- **Database split into app.db + market.db** — the single SQLite is split along a
  lifecycle boundary: **app.db** is the system of record (accounts, buckets,
  holdings, plans, journal, models, chat, preferences, user market indicators)
  and **market.db** holds regenerable data (fund catalog/fees/performance/
  portfolio/feeder + the NAV/quote cache). A two-handle `DbContext` routes queries
  by domain; no join crosses the boundary. better-auth uses app.db; backups cover
  app.db only (market.db is regenerable and excluded from restic). Demo sessions
  get an isolated in-memory app.db but share the real market.db read-write, like a
  real user — demo reads from and warms the same NAV/quote cache (market data is
  global, so demo cache fills just cut redundant upstream fetches). New env var
  `MARKET_DB_PATH` (default `data/market.db`, same `data/` volume); the existing
  combined DB was migrated once into the split layout at rollout. Rationale: blast-radius
  isolation (the nightly SEC refresh can't endanger accounts), lean backups,
  credential-free dev clones, demo-with-real-data.
- **Denormalized `fund_catalog.current_ter`** — the finder sorts and annotates
  TER from a cached column on `fund_catalog` (maintained by `upsertFundFees`; the
  source of truth stays `fund_fees`), dropping the per-fund fee-history query.
  Browse-all and search are ~tens of ms. Composite `(proj_id, period)`
  performance/portfolio indexes round it out.
- **Drag-to-reorder** — **Manage Indicators** uses `@dnd-kit/react` (off the
  legacy `@dnd-kit/core` line); tier labels removed. The **Portfolios sidebar**
  reorders the portfolio list, persisted via a `buckets.position` column and
  `PATCH /api/portfolios/reorder`.
- **Navigation labels** — the **Funds** tab is **Explore** (catalog discovery,
  not a holdings list) and the **Chat** tab is **Advisor** (the AI investment
  advisor). Screen ids are unchanged, so routing is unaffected by the rename.
- **Login screen** — the sign-in screen matches the landing aesthetic: brand
  mark + wordmark (clickable home), pill buttons, and clearer copy (drops the
  "real DB" jargon; uses the **Advisor** / **Explore** names). A signed-in user
  hitting `/login` is redirected server-side rather than via a client-side
  bounce, so there's no flash of the login UI; the post-OAuth passkey prompt
  and the demo sign-in path are unaffected.
- **Fund detail dedupe** — duplicate portfolio rows are collapsed by identity
  (ISIN, or issuer + description) into one expandable net row.
- **Persistence layer** — SQLite + Drizzle (15 tables), daily rotating backups,
  full CRUD APIs, SWR fetchers; all seven screens read from the DB.
- **Passkey auth + demo mode** — better-auth + WebAuthn passkeys, secure-by-
  default gate (`AUTH_DISABLED=1` opt-out for local dev), per-session isolated
  in-memory demo databases routed via AsyncLocalStorage.
- **AI chat** — streaming `/api/chat` via the Vercel AI SDK + OpenRouter (one
  key, every major model), owner/demo provider routing, IP rate limit, security
  headers; chat history + thread-list sidebar with recency grouping and
  per-thread delete.
- **Advisor tool-calls** — read portfolio / **performance** / plan / journal,
  write journal, propose plan edit, propose holding; capped tool loop; per-user
  scoped. `read_performance` reports the portfolio's period return alongside the
  same-window SET + S&P 500 returns, so the advisor can answer "am I beating my
  index?" with real numbers. The advisor gives concrete, plan-anchored
  buy/sell/hold + rebalancing guidance (educational, with a standing disclaimer)
  and references only tickers its tools returned. **Proposal cards** (plan edits
  and holdings) that write through only on accept.
- **Portfolio analysis** — transparent 0–100 score (deterministic, from drift /
  fees / concentration / cash, with a per-component breakdown); the Plan &
  Health panel is driven by real signals (drift, blended TER, concentration,
  cash drag, rebalance hint).
- **Interactive charts** (recharts) with hover + tooltips, including a
  portfolio-vs-benchmark overlay (SET / S&P 500 / Nasdaq / Nikkei) drawn from
  real index series, aligned to the portfolio's dates and rebased to a common
  start.
- **Market data** — SET + global indices and FX (Yahoo); **Thai fund NAVs +
  NAV history** (Thai SEC Open API) behind a provider registry +
  `holdings.quote_source` taxonomy. Resilient to upstream rate-limits: a
  stale-on-error cache fallback and per-symbol backoff keep a warmed cache
  serving through Yahoo 429s, the Markets screen shows an honest "unavailable"
  state instead of fabricated numbers when nothing loads, and the demo cache is
  pre-warmed (indices + NAV history) so charts render instantly.
- **RSS news aggregator** — curated long-horizon editorial feeds on the markets
  screen (parallel fetch, dedupe, 30-min cache, partial-failure resilience);
  HTML entities in titles are decoded, including double-encoded ones.
- **Portfolio import** — Paste/CSV upload, editable table entry with symbol
  autocomplete (seed of known Thai funds + global indices, merged with the
  user's holdings), and **image OCR** (statement screenshot → structured rows via
  an OpenRouter vision model). The Add-holdings sheet validates rows before
  saving; quantity is required and average cost is optional.
- **Holding sources** — tag where each holding is held with a free-text source
  (suggestions from your past sources + common Thai fund platforms); rename a
  source across all your holdings from Settings → Sources.
- **Long-term memory** — bitemporal `user_preferences`, memory tools, always-on
  system-prompt injection, Settings → Memory, chat sidebar (auto-title, 30-day
  trash). Plus session lifecycle (active/idle/archived), real-time session-close
  extraction of durable facts (incremental, watermarked), chat summarization at
  ~80% context, `recall_preferences`, and sidebar full-text search (FTS5).
  Guide: [docs/explanation/memory.md](./docs/explanation/memory.md).
- **Multi-user with per-user data isolation** — `user_id` on app tables with
  **fail-closed scoping** (each account sees only its own rows; built-ins opt
  in explicitly), per-user investment plans, owner backfill from `OWNER_EMAIL`,
  `requireUser()` on API routes; holdings are scoped through their owning bucket
  (ownership validated on read + write).
- **Identity providers** — Google OAuth (env-gated; boots passkey-only with
  nothing set), post-OAuth passkey-registration prompt.
- **Quotas + tier gating** — `free` (free-model router only) vs `trusted`
  (owner model chain), daily token cap, per-user usage logging, limit UI.
- **Owner admin** — an owner-only screen (gated on `OWNER_EMAIL`, enforced
  server-side on every request) to list users and flip account tiers
  `free`↔`trusted`, replacing hand-written SQL; guarded against self-demote.
- **Sign-up gate** — Cloudflare Turnstile (dev-bypass when unset), wired auth
  rate limit, and an inline consent notice ("By continuing, you agree…") at
  account creation. `/legal/terms` + `/legal/privacy` are operator-configurable
  (name / contact / jurisdiction via env; nothing operator-specific committed).
- **Account page** — single "Sign in" section with passkeys (revoke, with a
  last-passkey lockout guard) named from their AAGUIDs, linked OAuth providers,
  usage, and sign-out everywhere.
- **Public signed-out landing page** for the shared link, with CTAs to sign in
  or try the demo. Real-app screenshots ride inside the iPhone bezel SVGs on
  the hero and Advisor sections (with a graceful fallback to the coded mocks);
  a "bigger canvas" section between the Advisor spotlight and the four-stage
  Loop shows the desktop screenshot inside a pure macOS-style window border —
  rounded rect, multi-layer shadow + hairline ring, image's natural aspect
  ratio drives the height.
- **Tooling baseline** — Biome (lint + format), GitHub Actions CI, Dependabot,
  git pre-commit hooks, Node 24.
