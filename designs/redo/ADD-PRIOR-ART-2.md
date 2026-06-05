# Add-flow prior art, part 2: Maybe Finance & Beancount

A focused deep-dive on how two mature open-source finance projects let a user record
**(a) an existing holding / opening balance / snapshot** and **(b) buy / sell / dividend
transactions** — and whether they unify those in one model or surface.

Source-level findings (read from the actual repos), with URLs. Written for the macrotide
unified add-modal redesign (one surface, snapshot + transactions, per-row `Type`).

---

## 1. Maybe Finance

**Current state / version caveat.** The original `maybe-finance/maybe` repo was the hosted
product; the company wound down and the repo is now community-maintained but still the
canonical codebase. Everything below is read from `main` as of June 2026. The model
described here is the **post-namespace-refactor** design (PRs
[#892](https://github.com/maybe-finance/maybe/issues/892),
[#923](https://github.com/maybe-finance/maybe/pull/923),
[#974](https://github.com/maybe-finance/maybe/pull/974),
[#1506](https://github.com/maybe-finance/maybe/pull/1506)) — note these PRs predate a later
rename where the models moved **out** of the `Account::` namespace: in current `main` the
classes are top-level `Entry`, `Transaction`, `Trade`, `Valuation`, `Holding` (the DeepWiki
and older PRs still call them `Account::Entry` etc.). Same design, newer names.

### 1.1 The unified ledger: one `Entry` table, delegated `entryable` types

Maybe has **one ledger** — the `Entry` model — and everything that changes an account's
history is an entry. It uses Rails' **delegated type** pattern: an `Entry` carries the shared
columns (date, name, amount, currency, account) and delegates to one of three "entryable"
types.

[`app/models/entry.rb`](https://github.com/maybe-finance/maybe/blob/main/app/models/entry.rb):

```ruby
class Entry < ApplicationRecord
  include Monetizable, Enrichable
  monetize :amount

  belongs_to :account
  belongs_to :transfer, optional: true

  delegated_type :entryable, types: Entryable::TYPES, dependent: :destroy
  accepts_nested_attributes_for :entryable

  validates :date, :name, :amount, :currency, presence: true
  # only ONE valuation per account per day:
  validates :date, uniqueness: { scope: [ :account_id, :entryable_type ] }, if: -> { valuation? }

  scope :chronological, -> {
    order(date: :asc,
      # valuations sort AFTER transactions/trades on the same day:
      Arel.sql("CASE WHEN entries.entryable_type = 'Valuation' THEN 1 ELSE 0 END") => :asc,
      created_at: :asc)
  }
end
```

The three entryable types (`Entryable::TYPES`):

| Type | What it means | Effect on balance |
|---|---|---|
| **`Transaction`** | Cash in/out (income/expense), the everyday line item | **Adjusts** prior-day balance by `amount` |
| **`Trade`** | Buy/sell of a security: has `qty`, `price`, `security` | **Adjusts** prior-day balance; also moves share quantity |
| **`Valuation`** | "This account is worth $X on date Y" — an **absolute anchor / snapshot** | **Sets** the balance to `amount` (overrides the running sum) |

This is the core distinction and the most directly relevant idea for macrotide:
**Transaction and Trade are deltas; Valuation is an absolute snapshot.** They all live in
the same `entries` table and the same chronological timeline.

> DeepWiki summarises it as: *"`Account::Valuation` sets the new account balance to the
> valuation amount … while `Account::Transaction` and `Account::Trade` are adjustments to the
> prior day balance."*
> ([DeepWiki: Account Management](https://deepwiki.com/maybe-finance/maybe/6.1-account-management))

### 1.2 What a `Valuation` is — and the three `kind`s (the key insight)

A `Valuation` is a **balance anchor**. The model itself is tiny — the meaning is carried by a
`kind` enum.

[`app/models/valuation.rb`](https://github.com/maybe-finance/maybe/blob/main/app/models/valuation.rb):

```ruby
class Valuation < ApplicationRecord
  include Entryable

  enum :kind, {
    reconciliation: "reconciliation",   # default
    opening_anchor: "opening_anchor",
    current_anchor: "current_anchor"
  }, validate: true, default: "reconciliation"
end
```

So one entryable type serves **three roles** distinguished only by `kind`:

- **`opening_anchor`** — the account's **opening balance** (the snapshot at account birth).
- **`current_anchor`** — a "the account is worth $X today" anchor (used for manual/untracked
  accounts whose true current value you just type in).
- **`reconciliation`** — a mid-history "actually the balance was $X on this date" correction
  (a manual balance update that creates an audit-trail snapshot).

The `Anchorable` concern documents the mental model in a one-line comment that macrotide
should basically steal:

[`app/models/account/anchorable.rb`](https://github.com/maybe-finance/maybe/blob/main/app/models/account/anchorable.rb):

```ruby
# All accounts are "anchored" with start/end valuation records, with transactions,
# trades, and reconciliations between them.
module Account::Anchorable
  monetize :opening_balance
  def set_opening_anchor_balance(**opts) ... end   # opening_anchor valuation
  def set_current_balance(balance) ... end          # current_anchor valuation
end
```

A **`Trade` differs from a `Valuation`** in that a Trade is a *security-level delta* — it has
`qty`, `price`, `security_id`, and it changes how many shares you hold; it never sets an
absolute account value. A Valuation has no security and no qty — it just stamps a total
dollar value onto the account timeline.

[`app/models/trade.rb`](https://github.com/maybe-finance/maybe/blob/main/app/models/trade.rb):

```ruby
class Trade < ApplicationRecord
  include Entryable, Monetizable
  monetize :price
  belongs_to :security
  validates :qty, presence: true
  validates :price, :currency, presence: true

  def self.build_name(type, qty, ticker)   # "Buy 100 shares of AAPL"
    prefix = type == "buy" ? "Buy" : "Sell"
    "#{prefix} #{qty.to_d.abs} shares of #{ticker}"
  end
end
```

Buy vs sell is encoded by the **sign of `qty`** (buy = positive, sell = negative) — there's
no separate "sell" model.

### 1.3 How the opening balance is set (manual account creation → an opening_anchor Valuation)

When you create a manual account, the initial balance you type becomes an **`opening_anchor`
Valuation entry** — it is *not* a special column, it's a row in the same ledger.

[`app/models/account.rb`](https://github.com/maybe-finance/maybe/blob/main/app/models/account.rb)
`create_and_sync`:

```ruby
def self.create_and_sync(attributes)
  account = new(attributes.merge(cash_balance: attributes[:balance]))
  initial_balance = attributes.dig(:accountable_attributes, :initial_balance)&.to_d
  transaction do
    account.save!
    manager = Account::OpeningBalanceManager.new(account)
    result = manager.set_opening_balance(balance: initial_balance || account.balance)
    raise result.error if result.error
  end
  account.sync_later
  account
end
```

[`app/models/account/opening_balance_manager.rb`](https://github.com/maybe-finance/maybe/blob/main/app/models/account/opening_balance_manager.rb)
creates the entry — literally an `Entry` wrapping a `Valuation(kind: "opening_anchor")`:

```ruby
def create_opening_anchor(balance:, date:)
  account.entries.create!(
    date: date,
    name: Valuation.build_opening_anchor_name(account.accountable_type),
    amount: balance,
    currency: account.currency,
    entryable: Valuation.new(kind: "opening_anchor")
  )
end
```

Notable details worth copying:
- If no explicit opening date, it back-dates to `oldest_entry_date - 1.day` (or 2 years ago)
  so the anchor always sorts *before* the first real transaction.
- Setting the opening balance again **updates the existing anchor** rather than stacking a
  second one (`update_opening_anchor`), enforced by the per-day uniqueness validation above.

### 1.4 How holdings are computed — **derived, not stored as the source of truth**

For an investment account, **share-level holdings are recalculated from the Trade entries**,
not authored directly. There are forward and reverse calculators.

[`app/models/holding/forward_calculator.rb`](https://github.com/maybe-finance/maybe/blob/main/app/models/holding/forward_calculator.rb):

```ruby
class Holding::ForwardCalculator
  def calculate
    current_portfolio = generate_starting_portfolio   # all securities at qty 0
    holdings = []
    account.start_date.upto(Date.current).each do |date|
      trades = portfolio_cache.get_trades(date: date)
      next_portfolio = transform_portfolio(current_portfolio, trades, direction: :forward)
      holdings += build_holdings(next_portfolio, date)  # qty * price for each security/day
      current_portfolio = next_portfolio
    end
    Holding.gapfill(holdings)
  end

  def transform_portfolio(previous, trade_entries, direction:)
    new_q = previous.dup
    trade_entries.each do |te|
      qty_change = te.entryable.qty
      qty_change *= -1 if direction == :reverse
      new_q[te.entryable.security_id] = (new_q[te.entryable.security_id] || 0) + qty_change
    end
    new_q
  end
end
```

So a `Holding` row is a **materialized, per-day snapshot** (`security`, `qty`, `price`,
`amount=qty*price`, `date`) produced by walking the trade ledger forward day-by-day and
multiplying by that day's price. The `ReverseCalculator` does the same backward from a known
current position (used when the provider gives you "current holdings" and you reconstruct
history). Holdings are a **derived cache**, not the authored truth — the Trades + Valuations
in the ledger are.

`Account#current_holdings` then just picks the latest non-zero row per security:

```ruby
def current_holdings
  holdings.where(currency: currency).where.not(qty: 0)
    .where(id: holdings.select("DISTINCT ON (security_id) id")
                       .order(:security_id, date: :desc))
    .order(amount: :desc)
end
```

Account total value = **cash balance + Σ(holding amounts)** for a date (per DeepWiki). Cost
basis is an approximation derived from trade prices ([`holding.rb#avg_cost`](https://github.com/maybe-finance/maybe/blob/main/app/models/holding.rb)
averages `trades.price` where `qty > 0`), not stored per-lot — an important contrast with
Beancount below.

### 1.5 The add form — one type selector that derives the fields

There are separate controllers/forms per entryable (`transactions`, `trades`, `valuations`),
but the **trade form is itself a mini unified add-modal**: a single `type` dropdown reshapes
the visible fields.

[`app/views/trades/_form.html.erb`](https://github.com/maybe-finance/maybe/blob/main/app/views/trades/_form.html.erb):

```erb
<% type = params[:type] || "buy" %>
<%= form.select :type, [
    ["Buy", "buy"], ["Sell", "sell"],
    ["Deposit", "deposit"], ["Withdrawal", "withdrawal"], ["Interest", "interest"]
  ], { selected: type },
  { data: { action: "trade-form#changeType", ... } } %>

<% if %w[buy sell].include?(type) %>
  <%= form.combobox :ticker, ... %>          <%# ticker only for buy/sell %>
<% end %>
<%= form.date_field :date, value: model.date || Date.current %>
<% unless %w[buy sell].include?(type) %>
  <%= form.money_field :amount %>            <%# cash types take an amount %>
<% end %>
<% if %w[deposit withdrawal].include?(type) %>
  <%= form.collection_select :transfer_account_id, ... %>   <%# transfer pairs an account %>
<% end %>
<% if %w[buy sell].include?(type) %>
  <%= form.number_field :qty %>
  <%= form.money_field :price %>             <%# qty+price only for buy/sell %>
<% end %>
```

So a Stimulus controller (`trade-form#changeType`) swaps fields live as the type changes:
- **Buy/Sell** → ticker + qty + price (amount derived = qty×price)
- **Deposit/Withdrawal** → amount + counterparty account (a transfer)
- **Interest** → amount only

The **Valuation** ("update balance" / reconcile) flow is a separate, very small form — just
a date + new balance — surfaced from the balance area rather than the trade form. The
*opening balance* is captured at account-creation time, not in this add form.

**Surface summary (Maybe).** One ledger (`entries`), one chronological timeline mixing
Transactions, Trades, and Valuations. The UI has distinct entry points (add transaction, add
trade, update balance) but they all write to the same table; holdings are a separate read-only
*derived* surface. The opening balance is a `Valuation(opening_anchor)` row — the snapshot
literally lives in the transaction ledger.

---

## 2. Beancount

Beancount is plain-text double-entry accounting. Everything is a **directive** in a text
file; there is no separate "holdings store" — positions are derived by replaying postings.
This is the purest expression of "snapshot and transactions in one model": they're all
directives in the same file, distinguished by keyword.

Docs: [Beancount Language Syntax](https://beancount.github.io/docs/beancount_language_syntax.html)
· [GitHub mirror](https://github.com/beancount/docs/blob/master/docs/beancount_language_syntax.md)
· [Trading with Beancount](https://github.com/beancount/docs/blob/master/docs/trading_with_beancount.md)

### 2.1 Opening a balance: `open`, `balance`, `pad`, and `Equity:Opening-Balances`

**`open`** just declares an account exists (optionally constraining its commodities):

```
2014-05-01 open Liabilities:CreditCard:CapitalOne   USD
```

**`balance`** is an *assertion*, not an entry that moves money — "I assert this account holds
exactly this on this date; error out if the computed balance disagrees":

```
2014-12-26 balance Liabilities:US:CreditCard   -3492.02 USD
```

**`pad`** is the magic that turns a balance assertion into an opening balance. It tells
Beancount: *automatically insert a balancing transaction between these two accounts so the
next `balance` assertion passes.* The counter-leg is conventionally `Equity:Opening-Balances`:

```
2002-01-17 open    Assets:US:BofA:Checking
2002-01-17 pad     Assets:US:BofA:Checking  Equity:Opening-Balances
2014-07-09 balance Assets:US:BofA:Checking  987.34 USD
```

Beancount auto-synthesizes a transaction dated `2002-01-17` that deposits exactly
`987.34 USD` into Checking and pulls the same out of `Equity:Opening-Balances`. The equity
account is the **"where did this pre-existing money come from" sink** — it has no cash leg,
which is precisely what distinguishes an opening snapshot from a real transaction.

> **Important limitation:** `pad` only works for cash-like accounts. *"Pad directives do not
> currently work with accounts holding positions held at cost … balance assertions do not yet
> allow specifying a cost basis to assert."* For a pre-existing **investment** position you
> write the opening transaction manually (next section).

### 2.2 Recording an existing position WITH cost basis — lots in one posting

Cost basis is recorded inline with **curly-brace lot syntax**: `{cost-per-unit CURRENCY}`,
optionally `{cost, date}`. Curly braces are what make a number-of-shares posting balance
against a dollar figure.

A pre-existing holding (snapshot, counter-leg = Equity, **no cash leg**):

```
2014-06-01 * "Opening balances"
  Assets:US:ETrade:AAPL    5 AAPL {578.23 USD}
  Equity:Opening-Balances
```

Beancount books the 5 AAPL **at a cost of 578.23 USD each**; the Equity leg auto-balances to
`-2891.15 USD`. The lot `{578.23 USD}` is stored with the position, so cost basis is
**explicit and per-lot** (contrast Maybe's derived `avg_cost`).

**Multiple lots** of the same security coexist as distinct cost layers — you just write
multiple postings (or accumulate them via separate buys), and you can carry an acquisition
date:

```
2014-06-01 * "Opening balances — two AAPL lots"
  Assets:US:ETrade:AAPL    5 AAPL {578.23 USD, 2013-02-11}
  Assets:US:ETrade:AAPL    7 AAPL {610.00 USD, 2013-09-04}
  Equity:Opening-Balances
```

### 2.3 Buy / sell — the cash leg is what makes it a transaction (not a snapshot)

**Buy** — shares in at cost, **cash out**, commission expensed:

```
2014-02-16 * "Buying some IBM"
  Assets:US:ETrade:IBM               10 IBM {160.00 USD}
  Assets:US:ETrade:Cash        -1609.95 USD
  Expenses:Financial:Commissions   9.95 USD
```

**Sell** — shares out *at their original cost lot* `{160.00 USD}`, sold `@ 170.00 USD`, cash
in, and a P&L income leg that Beancount **auto-computes** when left blank:

```
2014-02-17 * "Selling some IBM"
  Assets:US:ETrade:IBM           -3 IBM {160.00 USD} @ 170.00 USD
  Assets:US:ETrade:Cash         500.05 USD
  Expenses:Financial:Commissions  9.95 USD
  Income:US:ETrade:PnL                          ; left blank → solved to the gain
```

The `{160.00 USD}` selects **which lot** you're reducing (cost basis); the `@ 170.00 USD` is
the **sale price** (used only to value the proceeds, not to balance). Selling across lots:

```
2014-03-18 * "Selling all my blue chips."
  Assets:US:ETrade:IBM          -7 IBM {160.00 USD} @ 172.00 USD
  Assets:US:ETrade:IBM          -5 IBM {180.00 USD}
  Assets:US:ETrade:Cash       2054.05 USD
  Expenses:Financial:Commissions  9.95 USD
  Income:US:ETrade:PnL
```

**The snapshot-vs-trade distinction, made concrete:**

| | Opening snapshot | Buy/Sell trade |
|---|---|---|
| Share leg | `5 AAPL {578.23 USD}` | `10 IBM {160.00 USD}` |
| Counter-leg | `Equity:Opening-Balances` (no cash) | `Assets:…:Cash` (real money moves) |
| Income leg | none | `Income:…:PnL` on sells |
| Meaning | "I already owned this" | "money changed hands now" |

Same posting machinery; the only difference is **what the other leg is**. That is the entire
unification trick.

### 2.4 Dividends — income account, no change in share quantity

A **cash dividend** is just cash in + an income leg; crucially **no commodity/qty posting**,
so share count is untouched:

```
2014-02-16 * "Dividends from LQD"
  Assets:US:ETrade:Cash         87.45 USD
  Income:US:ETrade:Dividends   -87.45 USD
```

(A **stock** dividend, by contrast, *does* add shares at a cost and credits dividend income:
`Assets:…:RBF1005  7.234 RBF1005 {23.64 CAD}` / `Income:Investments:Dividends`.)

### 2.5 The UI layer: Fava

[Fava](https://github.com/beancount/fava) is the web front-end. Its add-entry experience is
the **direct precedent for a unified add-modal with a per-entry Type selector**.

- Open the add form with the **`+` button or `n` shortcut**
  ([features](https://github.com/beancount/fava/blob/main/src/fava/help/features.md)).
- The modal has a **type dropdown** that swaps the sub-form. From
  [`frontend/src/modals/AddEntry.svelte`](https://github.com/beancount/fava/blob/main/frontend/src/modals/AddEntry.svelte):

  ```ts
  const entryTypes = [
    [Transaction, _("Transaction")],
    [Balance,     _("Balance")],
    [Note,        _("Note")],
  ];
  let entry = $state.raw(Transaction.empty(todayAsString()));
  // {#each entryTypes as [Cls, displayName]} → <select> that rebuilds `entry`
  ```

  and [`frontend/src/entry-forms/Entry.svelte`](https://github.com/beancount/fava/blob/main/frontend/src/entry-forms/Entry.svelte)
  renders a different field set per type:

  ```svelte
  {#if entry instanceof Balance}      <BalanceSvelte bind:entry />
  {:else if entry instanceof Note}    <NoteSvelte bind:entry />
  {:else if entry instanceof Transaction} <TransactionSvelte bind:entry />
  ```

- So Fava **is** the pattern macrotide wants: **one modal, a Type `<select>` (Transaction /
  Balance / Note), and the field set + the sub-form swap based on the chosen type.** A
  Transaction form has **draggable postings** with "full cost syntax supported" (so lots /
  `{}` work in the guided form, not just raw text); a Balance entry is the
  assertion/snapshot. Account names, payees and tags autocomplete.
- Fava also keeps a **raw source editor** (the Editor) and a single-entry edit overlay
  (click the date in the Journal) — guided form *and* text are both available.

> Caveat: Fava's add form exposes **Transaction / Balance / Note** by default; `open`, `pad`,
> `commodity`, etc. are typically authored in the source editor rather than the guided modal.
> Cost-lot editing in the posting rows has improved over versions — version-dependent, so
> confirm against your target Fava release.

---

## 3. What macrotide can borrow — for a unified add-modal (per-row `Type`)

1. **Make the opening balance / snapshot a *row in the same ledger*, not a special field.**
   Maybe's `Valuation(kind: opening_anchor)` and Beancount's `pad → Equity:Opening-Balances`
   both prove the snapshot belongs *in* the transaction stream as just another typed entry.
   This is exactly the unified surface the redesign wants — one timeline, the opening balance
   sorts first.

2. **Adopt the delta-vs-anchor split as the spine of the `Type` enum.** Two kinds of rows:
   *deltas* (Buy, Sell, Dividend, Deposit/Withdraw — adjust the running balance/qty) and
   *anchors/snapshots* (Opening balance, "value today", reconcile — **set** an absolute
   value). Maybe encodes this as Transaction/Trade (delta) vs Valuation (anchor); copy the
   one-liner: *"accounts are anchored with start/end valuation records, with transactions and
   trades between them."* Make valuations sort *after* same-day deltas (Maybe's
   `chronological` scope) so a stated balance wins on its date.

3. **Three flavours of "snapshot," not one.** Maybe's `opening_anchor` / `current_anchor` /
   `reconciliation` enum is a clean model: opening balance, "it's worth $X today," and a
   mid-history correction are the *same* row type with different intent. macrotide's per-row
   Type can offer "Opening balance" and "Set balance / reconcile" as snapshot variants.

4. **Derive holdings/cost basis from the ledger; don't make the user double-author them.**
   Maybe materializes per-day `Holding` rows by replaying Trades (forward/reverse
   calculators), and Beancount replays postings — in both, holdings are a *computed view*.
   For macrotide: a Buy/Sell row + an Opening-position row are enough; the holdings table is a
   read model. (Decide explicitly whether to store **per-lot cost** like Beancount's `{cost}`
   — exact, supports specific-lot sells — or a **derived average** like Maybe's `avg_cost` —
   simpler, lossy. For a snapshot-first app, capturing cost on the opening row, Beancount-style,
   is the richer choice.)

5. **One modal, a Type `<select>`, fields that reshape live — and derive amounts.** Both
   Maybe's `trades/_form` (`changeType` Stimulus action: ticker+qty+price for buy/sell, amount
   for cash, counterparty for transfers) and Fava's `AddEntry.svelte` (entryTypes dropdown →
   swap sub-form) are the literal UI blueprint. Per Type: Buy/Sell → ticker · qty · price ·
   (amount derived = qty×price · cost lot); Dividend → security · cash amount · income, **no
   qty change**; Opening/Snapshot → date · balance (or per-security qty+cost), **no cash leg**;
   Deposit/Withdraw → amount · counterparty account.

### Uncertainties / version flags
- **Maybe naming:** older PRs/DeepWiki say `Account::Entry`/`Account::Valuation`; current
  `main` uses top-level `Entry`/`Valuation`/`Trade`/`Holding`. Same design.
- **Maybe project status:** original company wound down; treat as community-maintained. Verify
  against the fork/branch you actually target.
- **Fava add-modal scope:** guided types are Transaction/Balance/Note; `open`/`pad` are usually
  source-edited. Posting-row cost-lot editing is version-dependent.
- **Beancount `pad`** cannot pad cost-held positions — opening *investment* positions must be
  authored as an explicit transaction with `{cost}` lots against `Equity:Opening-Balances`.

---

### Sources
- Maybe `Entry` model — https://github.com/maybe-finance/maybe/blob/main/app/models/entry.rb
- Maybe `Valuation` — https://github.com/maybe-finance/maybe/blob/main/app/models/valuation.rb
- Maybe `Trade` — https://github.com/maybe-finance/maybe/blob/main/app/models/trade.rb
- Maybe `Holding` — https://github.com/maybe-finance/maybe/blob/main/app/models/holding.rb
- Maybe `Holding::ForwardCalculator` — https://github.com/maybe-finance/maybe/blob/main/app/models/holding/forward_calculator.rb
- Maybe `Account` (`create_and_sync`, `current_holdings`) — https://github.com/maybe-finance/maybe/blob/main/app/models/account.rb
- Maybe `OpeningBalanceManager` — https://github.com/maybe-finance/maybe/blob/main/app/models/account/opening_balance_manager.rb
- Maybe `Anchorable` / `Reconcileable` concerns — https://github.com/maybe-finance/maybe/blob/main/app/models/account/anchorable.rb
- Maybe `trades/_form.html.erb` — https://github.com/maybe-finance/maybe/blob/main/app/views/trades/_form.html.erb
- Maybe namespace proposal / refactor PRs — https://github.com/maybe-finance/maybe/issues/892 · https://github.com/maybe-finance/maybe/pull/923 · https://github.com/maybe-finance/maybe/pull/974 · https://github.com/maybe-finance/maybe/pull/1506
- Maybe Account Management (DeepWiki) — https://deepwiki.com/maybe-finance/maybe/6.1-account-management
- Beancount language syntax — https://beancount.github.io/docs/beancount_language_syntax.html · https://github.com/beancount/docs/blob/master/docs/beancount_language_syntax.md
- Trading with Beancount — https://github.com/beancount/docs/blob/master/docs/trading_with_beancount.md
- Fava repo / features — https://github.com/beancount/fava · https://github.com/beancount/fava/blob/main/src/fava/help/features.md
- Fava `AddEntry.svelte` — https://github.com/beancount/fava/blob/main/frontend/src/modals/AddEntry.svelte
- Fava `Entry.svelte` (per-type sub-forms) — https://github.com/beancount/fava/blob/main/frontend/src/entry-forms/Entry.svelte
