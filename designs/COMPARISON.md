# Transactions UI redesign — four directions

Four designers each took a distinct lens and committed hard to it. None were told the
owner's specific complaints (independent opinions by design). The backend (`/api/transactions*`,
analytics, OCR) is fixed; all four design only the React/CSS layer.

| # | Name | Lens | Form factor | One-line |
|---|------|------|-------------|----------|
| 01 | **Money Story** | Consumer fintech (Copilot/Robinhood) | `/activity` route + compose drawer | Reverse-chron feed of friendly event cards; one bold headline number; holdings float above as "standings" and filter the feed |
| 02 | **The Register** | Power tool (Linear/Lunch Money) | `/activity` route, full page | Keyboard-first ledger; pinned quick-add row; every cell edits in place; paste/OCR stage as a pending tray; analytics in a collapsed rail |
| 03 | **The Ledger Story** | Editorial (NYT graphics / bank statement) | Tab inside Journal screen | Vertical timeline, chapters by year, events woven with narrated milestones; realized gains shown where they were banked |
| 04 | **One Truth** | Information architecture | `/portfolio/[ticker]` position pages | No separate Activity; a holding's running total sits directly above the ledger it's derived from; drill in/out |

## How they differ on the key axes

- **Where activity lives:** 01/02 = a new top-level screen · 03 = inside Journal · 04 = inside each holding (no "Activity" destination at all).
- **Density vs. story:** 02 most dense/fast → 01 → 04 → 03 most narrative/calm.
- **Solves the holdings↔history split by:** 01 standings-above-feed · 02 deep-linking holdings into the ledger · 03 "summary = where the story got to" · 04 collapsing them into one object (the most radical IA fix).
- **Recording:** 01 light budgeting-app compose sheet · 02 inline pending-tray in the register · 03 right drawer with story-preview confirm · 04 composer docked to a position.
- **Honest tradeoff each makes:** 01 weaker for bulk audit · 02 learning curve for first-timers · 03 poor bulk-reconcile surface · 04 "see everything at once" is one click away.

Full docs: `01-money-story-feed.md`, `02-fast-register.md`, `03-narrative-timeline.md`, `04-unified-surface.md`.
