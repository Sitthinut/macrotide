# Adding Investment Data — Prior Art

Research into how OSS and commercial portfolio tools let users record (a) a current-holdings snapshot / opening balance and (b) buy/sell/dividend transactions, to inform a single unified "Add to portfolio" modal.

Scope: medium-thorough survey. Claims are cited inline; uncertain points are flagged.

---

## 1. Do tools unify opening-balance with transactions, or separate them — and why?

The field splits into two camps, and the split is the single most important finding.

**Separate, deliberately (the "serious tracker" camp).** Sharesight and Snowball Analytics treat "current holdings snapshot" and "full transaction history" as two distinct *portfolio modes / import paths*, not two row types in one surface.

- Snowball makes this an explicit account-level choice: a **Holdings portfolio** ("much easier and faster because you only enter current positions") vs a **Transactions portfolio** (buy/sell, dividends, fees → adds IRR, realized P&L, value history, dividend/fee tracking). The tradeoff is stated plainly: holdings = quick monitoring, transactions = "the best and most powerful way to track and analyze your portfolio performance." ([snowball-analytics.com/holdings-vs-transactions](https://help.snowball-analytics.com/holdings-vs-transactions/))
- Sharesight offers three on-ramps — bulk import historical trades, bulk import a broker file, or **import opening balances** — and frames opening-balance as the fallback "if you don't need your full transaction history and just want your current holdings reflected correctly." It's a separate importer with its own required fields (date, instrument code, market, quantity, cost base). ([opening balances](https://help.sharesight.com/upload-import-opening-balances/), [bulk trades](https://help.sharesight.com/import_bulk_trades/), [adding investments](https://help.sharesight.com/au/adding-your-investments-into-sharesight/))

  The *reason* they separate: the two carry different fidelity. An opening balance is a single dated equity snapshot (cost base only, no per-trade history → money-weighted return from that date forward); a transaction list yields full historical performance. They don't want users to think a snapshot gives them history it can't.

**Unified, at the seam (the "one ledger, snapshot is just an entry" camp).** Plain-text accounting and Portfolio Performance unify them by making the opening balance *a kind of transaction* in the same register.

- **Portfolio Performance**: an existing holding is entered as a **Delivery (Inbound)** — "the addition or removal of securities from a securities account, without requiring a deposit transaction." It lives in the same portfolio-transaction list as Buy/Sell, shares the same fields (date, shares, quote), and an open position can be *opened by either a Buy or an Inbound Delivery*. So snapshot and trade are sibling types in one surface, distinguished only by whether a cash account is debited. ([delivery reference](https://help.portfolio-performance.info/en/reference/transaction/delivery/), [recording a delivery](https://help.portfolio-performance.info/en/getting-started/manage-portfolio/delivery/))
- **Beancount / hledger / ledger**: the opening balance is literally a transaction dated in the past whose counter-account is `Equity:Opening-Balances` (instead of a cash/bank account). Same syntax, same file, same register as a buy. ([beancount opening balances thread](https://groups.google.com/g/beancount/c/0UNgiyDKmD8))

**Unified, pragmatically (the "consumer app" camp).** Copilot, Monarch, Yahoo Finance, Ghostfolio fold both into one add surface but resolve the snapshot question differently (see §2).

Takeaway: a unified modal is well-precedented — but the tools that unify do it by reframing the snapshot as "a transaction with no cash leg," not by adding a holdings/transactions toggle.

---

## 2. How is "I already held this" (opening / starting balance) represented?

| Tool | Representation of an existing position |
| --- | --- |
| **Portfolio Performance** | **Delivery (Inbound)** — security enters the account "as if by magic," no deposit-account debit. Same dialog as Buy minus the cash side. Recommended for portfolio reconstruction when historical prices/fees/dates are unavailable, inheritance/gifts (only current price known), and currency-mismatch cases. ([ref](https://help.portfolio-performance.info/en/reference/transaction/delivery/)) |
| **Beancount / hledger / ledger** | A past-dated transaction whose balancing leg is `Equity:Opening-Balances`. Per-lot cost basis encoded inline: `Assets:Brokerage:ACME 10 ACME {10.00 USD, 2015-01-01}`. Multiple lots at different cost/date in one entry. ([thread](https://groups.google.com/g/beancount/c/0UNgiyDKmD8)) |
| **Ghostfolio** | No dedicated "opening balance" type — you seed a position with a **BUY activity at a past date**. Limitation surfaced by users: a current snapshot gives cost basis + value but not a real purchase date, so seeding without history is a known awkward spot. ([github/ghostfolio](https://github.com/ghostfolio/ghostfolio), [discussion #6004](https://github.com/ghostfolio/ghostfolio/discussions/6004)) |
| **Sharesight** | A first-class **Opening Balance** record: date + instrument + market + quantity + cost base; "treated as a starting position rather than individual transactions," money-weighted from that date. ([ref](https://help.sharesight.com/upload-import-opening-balances/)) |
| **Snowball Analytics** | Account-level: in a Holdings portfolio you "add current amount and average cost"; the snapshot *is* the data model. ([ref](https://help.snowball-analytics.com/holdings-vs-transactions/)) |
| **Copilot** | During manual-account setup you "add a holding" (pick security, enter quantity held) → this seeds the baseline. Subsequent **LOG A MOVEMENT** entries adjust it. Holding setup and movements are unified ("uses initial holdings as a reference baseline, with movements updating the current position"). ([copilot help](https://help.copilot.money/en/articles/6097003-tracking-holdings-with-manual-accounts)) |
| **Monarch** | Manual holding = name account + type + search security + **enter quantity owned**. Notably **does not support manual entry of dividends or transaction history** — it's a snapshot-only model for manual accounts. ([monarch help](https://help.monarch.com/hc/en-us/articles/10032888165140-Manual-Investment-Holdings)) |
| **Yahoo Finance** | "Lots" under a symbol's Transactions tab; add-transaction with date-based auto-populated price. Snapshot = enter a lot. ([yahoo help](https://help.yahoo.com/kb/finance-for-web/add-remove-edit-transactions-portfolio-sln4178.html)) |

Two distinct mental models emerge for "I already held this":
1. **Snapshot-native** (Snowball Holdings, Monarch, Copilot setup): the position quantity + avg cost *is* the record.
2. **Transaction-as-snapshot** (PP Inbound Delivery, Beancount opening-balance entry, Ghostfolio past-dated BUY): the snapshot is a special transaction whose counter-leg is equity, not cash.

For a unified modal, model #2 is the cleaner fit: one entry type ("opening balance" / "I already owned this") that behaves like a Buy but skips the cash-out leg.

---

## 3. Import flows: CSV / broker / paste / OCR, and auto-detection

**Type auto-detection is rare and shallow.** Most importers make the user map a `type` column; they do *not* infer buy vs sell vs dividend from row shape.

- **Portfolio Performance** wizard auto-recognizes *column→field mappings* (`>>> 'Field'` hint per column) but the **transaction type is explicitly chosen by the user** from a dropdown (Securities / Account Transactions / Portfolio Transactions). The one genuine auto-detect: for Account Transactions, *if the Type column is omitted*, it assumes **Buy when Value is negative, Sell when positive** — sign-based inference, only as a fallback. ([csv import](https://help.portfolio-performance.info/en/reference/file/import/csv-import/))
- **Ghostfolio**: CSV/JSON import with explicit `type` column (`BUY`, `SELL`, `DIVIDEND`, `FEE`, `INTEREST`, `LIABILITY`, `ITEM`/valuable) plus `accountId, symbol, date, quantity, unitPrice, fee, currency, dataSource, comment`. Type is data, not inferred. A whole ecosystem of converters (Export-To-Ghostfolio, MSP-Importer) exists precisely *because* Ghostfolio doesn't auto-classify broker formats — they normalize broker exports into Ghostfolio's explicit type vocabulary upstream. ([discussion #6004](https://github.com/ghostfolio/ghostfolio/discussions/6004), [Export-To-Ghostfolio](https://github.com/dickwolff/Export-To-Ghostfolio))
- **Sharesight**: spreadsheet upload **auto-suggests field mappings** during column mapping, and "Broker Import" is married to the spreadsheet path; it also auto-creates dividends/corporate actions for imported holdings. Suggestion is for *mapping*, not type classification. ([broker import blog](https://www.sharesight.com/blog/introducing-broker-import/), [opening balances](https://help.sharesight.com/upload-import-opening-balances/))
- **Maybe Finance**: CSV import for transactions from most banks/brokerages, Mint-export import, Plaid sync if keyed; for investment-activity CSVs you tie a column to the **Ticker** field. Column-mapping, manual type. ([discussion #1656](https://github.com/maybe-finance/maybe/discussions/1656))
- **Monarch**: manual investment accounts are snapshot-only — **no transaction-history import for manual accounts** (sync handles it for connected ones). ([monarch help](https://help.monarch.com/hc/en-us/articles/10032888165140-Manual-Investment-Holdings))
- **OCR / image import**: not observed as a standard feature in any of these tools' docs. (Macrotide's own image-import is ahead of this prior art here — flag as a differentiator, not a copy-target.)

Pattern worth stealing: **auto-suggest column→field mapping** (Sharesight, PP) and **sign-based fallback inference** (PP: negative value ⇒ buy/cost). Both are low-risk, high-value.

---

## 4. Single-transaction add-form patterns

**Type-selector vocabularies:**

| Tool | Vocabulary |
| --- | --- |
| Ghostfolio | BUY · SELL · DIVIDEND · INTEREST · FEE · LIABILITY · ITEM/VALUABLE ([github](https://github.com/ghostfolio/ghostfolio), [#5355](https://github.com/ghostfolio/ghostfolio/issues/5355)) |
| Portfolio Performance | Buy · Sell · Delivery (Inbound) · Delivery (Outbound) · Transfer (In/Out); account side: Deposit · Withdrawal · Interest · Fee · Tax · Dividend ([csv import](https://help.portfolio-performance.info/en/reference/file/import/csv-import/)) |
| Copilot | Buy · Sell · Transfer In · Transfer Out (4 "movement" types) ([copilot](https://help.copilot.money/en/articles/6097003-tracking-holdings-with-manual-accounts)) |
| Firefly III (non-investment, instructive) | Withdrawal · Deposit · Transfer — *type is implied by which account types you pick as source/destination*, not a free dropdown ([transaction types](https://docs.firefly-iii.org/references/firefly-iii/transaction-types/)) |

**Fields & derived amounts:**
- Core set everywhere: date, security/ticker, quantity, unit price → **total = quantity × price** derived, plus a separate **fee** field. Currency where multi-currency.
- **Price auto-population by date** is common and reduces typing: Yahoo "stock price reflects the price based on the date of the transaction"; Copilot pre-fills date=today and price=current price. ([yahoo](https://help.yahoo.com/kb/finance-for-web/add-remove-edit-transactions-portfolio-sln4178.html), [copilot](https://help.copilot.money/en/articles/6097003-tracking-holdings-with-manual-accounts))
- **Dividends** differ structurally: a cash amount tied to a security but with **no quantity-of-shares change** (Ghostfolio DIVIDEND, PP account-side Dividend). Don't force a units field on them.
- **Splits / corporate actions**: PP handles via Delivery or dedicated corporate-action handling; Sharesight auto-creates corporate actions for imported holdings. Splits change quantity without cash — same shape as an inbound delivery. ([sharesight corporate actions](https://help.sharesight.com/corporate-actions/))
- Firefly's design lesson: **infer type from the accounts involved** rather than asking — e.g. asset→expense = withdrawal. Analog for investing: cash-leg present ⇒ Buy/Sell; no cash leg ⇒ opening balance / delivery.

**Split handling (GnuCash/Firefly):** transactions are multi-leg ("splits"); GnuCash's register can show basic (summary), auto-split (expand current row), or journal (all legs) views. Splitting is power-user surface, usually collapsed by default. ([gnucash split register](https://www.gnucash.org/docs/v5/C/gnucash-guide/chapter_txns.html), [firefly splits](https://docs.firefly-iii.org/how-to/firefly-iii/finances/transactions/))

---

## 5. Register/grid vs card/list; mobile; cognitive-load reducers

- **Register/grid (desktop, power tools):** GnuCash split register = spreadsheet-like, edit-in-place, configurable cell types, multi-row layouts; three density modes (basic / auto-split / journal). Portfolio Performance = transaction table. These favor **inline editing** and dense review. ([gnucash split register API](https://code.gnucash.org/docs/STABLE/group__SplitRegister.html))
- **Card/list + modal (consumer apps):** Copilot, Monarch, Yahoo mobile use a card/list of holdings with a per-item "+/log movement" affordance and a focused modal — fewer fields visible at once.
- **Mobile pattern (Copilot):** action button **"LOG A MOVEMENT"** anchored at the bottom of the account view; date defaults to today, price to current → a buy is often just "enter quantity." Strong cognitive-load reducer. ([copilot](https://help.copilot.money/en/articles/6097003-tracking-holdings-with-manual-accounts))
- **Cognitive-load reducers observed:** (a) auto-populate price from date; (b) derive total from qty×price; (c) suggest column mappings on import; (d) Firefly's "type is implied, not asked"; (e) collapse splits/advanced fields by default.

For Macrotide's "inline-editable Activity grid + one Add sheet" (per ledger #38), the **register-with-inline-edit** model (GnuCash/PP) is the closest match for review, paired with a **focused modal/sheet** (Copilot) for single adds — a grid+sheet hybrid.

---

## 6. Cautions — where tools deliberately keep them separate, and why

1. **Fidelity honesty (Sharesight, Snowball).** They separate opening-balance from full history because the two yield *different analytics* and they don't want to imply a snapshot delivers historical performance it can't. Snowball even gates IRR/realized-P&L behind the transactions model. ([snowball](https://help.snowball-analytics.com/holdings-vs-transactions/), [sharesight](https://help.sharesight.com/upload-import-opening-balances/))
2. **Performance-math divergence (Portfolio Performance).** Buy vs Delivery (Inbound) "can produce significantly different results" — a Buy moves cash and affects time-weighted return; a Delivery doesn't. Conflating them silently corrupts performance numbers. If a unified modal auto-picks the wrong one, the user's returns are wrong and they may never notice. ([pp delivery](https://help.portfolio-performance.info/en/reference/transaction/delivery/), [forum: delivery vs buy](https://forum.portfolio-performance.info/t/transactions-showing-delivery-instead-of-buy-or-sell/24746))
3. **Manual = snapshot-only by choice (Monarch).** Monarch declines manual dividend/transaction entry entirely for manual accounts — a deliberate scope cut to keep the manual surface simple, accepting reduced fidelity. ([monarch](https://help.monarch.com/hc/en-us/articles/10032888165140-Manual-Investment-Holdings))
4. **Firefly's split constraint.** You can't mix transaction types within one split entry (can't have one leg be a transfer and another an expense) — a unifying surface still needs type-coherence rules per entry. ([issue #4978](https://github.com/firefly-iii/firefly-iii/issues/4978))

The recurring reason to keep separate is **not UX preference — it's that the opening balance and a real trade compute differently downstream.** Unify the *entry surface*, but preserve the *semantic distinction* in the data model.

---

## Takeaways for a unified add modal

1. **Unify the surface, keep the semantic split in the data.** Precedent (PP Inbound Delivery, Beancount opening-balance entry) says the snapshot can be just another row type in the same surface — but it must remain a *distinct type* internally, because opening balances vs real trades compute differently for performance. Don't collapse them into one indistinguishable thing.

2. **Default the row type to BUY; make "opening balance" the natural sibling.** Buy is the highest-frequency action and the seed-an-existing-position case maps cleanly onto "a buy with no cash-out leg" (PP's Delivery, Ghostfolio's past-dated buy, Beancount's `Equity:Opening-Balances`). Frame opening balance to the user as *"I already owned this"* / *"starting position"* rather than accounting jargon like "inbound delivery."

3. **Auto-detect type from data shape, not from a mode toggle — and keep it sign/structure-based.** Follow PP's fallback: a cash-leg or negative value ⇒ Buy/Sell; quantity + cost with no trade date and no cash movement ⇒ opening balance; cash amount on a security with no quantity change ⇒ dividend. This is exactly the "type lives per-row, auto-detected" goal — and prior art shows it works best as *sign/column-structure inference*, not ML guessing.

4. **Borrow Sharesight/PP column-mapping auto-suggestion for paste/CSV.** Suggest the field mapping, let the user correct it. This is the single most common import affordance and it's low-risk. Pair with per-row type inference so a pasted block resolves to mixed BUY/SELL/DIVIDEND/OPENING rows automatically — then show them for confirmation (matches Macrotide's existing "editable confirmation table" pattern).

5. **Derive amounts; auto-populate price from date.** total = qty × price, separate fee field. Pre-fill price from the security's quote on the chosen date (Yahoo, Copilot) so a typical add is "ticker + quantity + date." Biggest cognitive-load win observed.

6. **Make dividends/splits first-class but shape-aware.** Dividend = cash tied to a security with no quantity change (hide the units field). Split/opening = quantity change with no cash leg. The "type" selector should reshape the form, not just label it (Firefly's "fields follow type" lesson).

7. **Show a confirmation/review grid with inline edit before commit.** The serious tools all let you review and fix per-row (GnuCash register, PP import preview, Sharesight mapping step). For a paste/import that auto-detected types, surface the detected type per row as an editable dropdown so users catch mis-classifications — directly mitigating the PP caution that a wrong auto-pick silently corrupts returns.

8. **Don't over-promise fidelity on snapshots; nudge toward trades where it matters.** Snowball/Sharesight separate the two partly to set expectations (snapshot ⇒ no historical performance). In a unified modal, an inline hint on an opening-balance row ("no historical performance before this date") preserves that honesty without a separate mode.

---

### Sources

- Ghostfolio: [github.com/ghostfolio/ghostfolio](https://github.com/ghostfolio/ghostfolio) · [CSV import discussion #6004](https://github.com/ghostfolio/ghostfolio/discussions/6004) · [activity type issue #5355](https://github.com/ghostfolio/ghostfolio/issues/5355) · [Export-To-Ghostfolio](https://github.com/dickwolff/Export-To-Ghostfolio)
- Maybe Finance: [import discussion #1656](https://github.com/maybe-finance/maybe/discussions/1656) · [releases](https://github.com/maybe-finance/maybe/releases)
- Portfolio Performance: [Delivery reference](https://help.portfolio-performance.info/en/reference/transaction/delivery/) · [Recording a Delivery](https://help.portfolio-performance.info/en/getting-started/manage-portfolio/delivery/) · [CSV import](https://help.portfolio-performance.info/en/reference/file/import/csv-import/) · [forum: delivery vs buy](https://forum.portfolio-performance.info/t/transactions-showing-delivery-instead-of-buy-or-sell/24746)
- Beancount: [opening balances for commodities thread](https://groups.google.com/g/beancount/c/0UNgiyDKmD8) · [quickref](https://plaintextaccounting.org/quickref/beancount)
- Firefly III: [transaction types](https://docs.firefly-iii.org/references/firefly-iii/transaction-types/) · [organize transactions](https://docs.firefly-iii.org/how-to/firefly-iii/finances/transactions/) · [mixed-type split issue #4978](https://github.com/firefly-iii/firefly-iii/issues/4978)
- GnuCash: [split register API](https://code.gnucash.org/docs/STABLE/group__SplitRegister.html) · [Transactions guide](https://www.gnucash.org/docs/v5/C/gnucash-guide/chapter_txns.html)
- Sharesight: [opening balances](https://help.sharesight.com/upload-import-opening-balances/) · [bulk trades](https://help.sharesight.com/import_bulk_trades/) · [Broker Import blog](https://www.sharesight.com/blog/introducing-broker-import/) · [corporate actions](https://help.sharesight.com/corporate-actions/) · [adding investments](https://help.sharesight.com/au/adding-your-investments-into-sharesight/)
- Snowball Analytics: [holdings vs transactions](https://help.snowball-analytics.com/holdings-vs-transactions/)
- Monarch: [manual investment holdings](https://help.monarch.com/hc/en-us/articles/10032888165140-Manual-Investment-Holdings) · [investments overview](https://help.monarch.com/hc/en-us/articles/41855507661076-Investments-in-Monarch)
- Copilot: [tracking holdings with manual accounts](https://help.copilot.money/en/articles/6097003-tracking-holdings-with-manual-accounts)
- Yahoo Finance: [add/edit transactions](https://help.yahoo.com/kb/finance-for-web/add-remove-edit-transactions-portfolio-sln4178.html)
</content>
</invoke>
