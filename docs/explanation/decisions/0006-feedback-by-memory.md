# ADR 0006 — Feedback is memory: corrections as the signal, a self-maintaining preference store

**Status:** Accepted; build tracked in [#96](https://github.com/Sitthinut/macrotide/issues/96). **Builds on** the [Memory](../memory.md) feature and its [prior-art survey](../research/memory-systems.md); the feedback-mechanism evidence is in [feedback-mechanisms.md](../research/feedback-mechanisms.md). Settles how the Advisor takes feedback while the app is still in internal testing.

**Context:** Designing how the Advisor learns from the user. A working [memory](../memory.md) store already holds what the Advisor knows about you; the open question is the **feedback** side — how a user signals that an answer missed or that something is worth remembering, what that signal becomes, and how the memory store should evolve to carry it well: cheaply, safely, and visibly. The app is in internal testing, so the design is ours to settle before real users depend on it.

The evidence (see [feedback-mechanisms.md](../research/feedback-mechanisms.md)) is one-directional: no serious agent wires thumbs into what it remembers; thumbs are low-signal (~13% of conversations leave any, no "why") and tying them to reward backfired industry-wide (the 2025 sycophancy rollback); **corrections** are the rare-but-unambiguous high-fidelity signal, and leading coding agents learn from corrections + explicit "remember," not ratings.

## The questions

1. What replaces the thumbs bar as the way users steer the Advisor?
2. If corrections feed memory, how is that **auditable** — and safe, given the output is financial guidance (a misread correction becomes a wrong durable fact)?
3. How far should the memory **store** evolve to support this without bloating per-chat cost or over-engineering for the current (small) scale?
4. How much may a user's remembered preferences **bend the Advisor's behavior** before that becomes unsafe?

## Decision

**Feedback is memory.** No ratings bar; treat a correction as the signal; capture it into the existing bitemporal preference store with a visible, reversible trail; and evolve the store the minimum amount needed to do that cheaply and safely. We rejected a from-scratch knowledge-graph rebuild and rejected adding semantic/vector retrieval at this scale.

### 1. No ratings bar; keep deliberate save

The Advisor does **not** take feedback through a 👍/👎 bar — a context-free rating is the weakest signal we could collect (the evidence is one-sided; see [feedback-mechanisms](../research/feedback-mechanisms.md)), so the unfinished `FeedbackRow` stub is dropped rather than completed. The **bookmark ("Save to Journal")** *does* belong — it's a deliberate user save, a different intent from feedback — so it's kept and wired to persist a `journal_entries kind:"note"`. The **Reading** list the Advisor already reads via `read_journal({kind:"reading"})` gains its dropped `url` field back so saved-article links are usable.

- **Rejected — keep a minimal 👎-only "what was off?" prompt.** Even one-sided, it's a per-turn nag competing with the correction the user is about to type anyway; the correction carries strictly more signal. If we ever want explicit negative signal, it routes through the same memory path as a correction, not a separate ratings table.

### 2. Corrections → memory, visibly, with the reject signal rerouted

When the user corrects the Advisor ("no, I said funds only"), the model captures it into memory through the existing tools, and the chat shows a **muted status line** (not a message bubble): *"Updated: funds only — no individual stocks"* with one-click undo. That line **is** the audit surface — it resolves the standing objection that background memory writes are un-auditable (the [memory-systems survey](../research/memory-systems.md) flagged this) by making every write visible at the moment it happens.

The Portfolio **"Not for me"** reject is rerouted off the dead `kind:"feedback"` row and into memory **as a pending candidate**, not a durable fact — *"You've passed on lower-fee swaps a few times; want me to remember you prefer staying put for tax reasons?"* A single dismissal is a weak signal for a durable financial constraint, so it must be confirmed before it can shape advice (see §4). The suppress/resurface ratchet that already governs re-showing rejected items (`action_item_states`, untouched by this) keeps working; only the dead journal write changes.

- **Rejected — keep writing `kind:"feedback"`.** Nothing reads it; it only backs a Feedback subtab we're not keeping. Dropping the kind is safe (suppression reads `action_item_states`, never the journal row).

### 3. Store evolution: progressive disclosure + consolidate-on-write + linked, integrity-enforced

Three additive changes to `user_preferences`, no rebuild:

- **Short index + optional detail (progressive disclosure).** Each entry gains a short `summary` and an optional capped `body`. Only `summary` is injected into the frozen hot block; `body` is reached via `recall_preferences`. This shrinks the recurring injected block (the thing billed on every chat) without losing detail — the [MemGPT/OKF "small core, fetch the rest"](../research/feedback-mechanisms.md) pattern.
- **Update, don't append.** On every write the Advisor reconciles against existing entries (add / supersede / forget) instead of piling up near-duplicates — the mem0 consolidate-on-write pattern. This caps per-user growth so the injected block stays small over time. It reuses the existing bitemporal supersede transaction; it's largely a tool-contract + prompt change, not new machinery.
- **Cross-links with DB-enforced integrity.** A `memory_links` join table connects related entries (e.g. a constraint ↔ the correction that set it). Integrity is the **database's** job, not the model's: links are foreign-keyed, and a validity-aware read never surfaces a link whose target has been superseded or soft-deleted. The model *proposes* links (meaning); the schema *guarantees* they can't dangle (integrity). Because a bitemporal update mints a new row id, links anchor to a stable key / re-point inside the supersede transaction — otherwise an edit silently orphans them.

```sql
ALTER TABLE user_preferences ADD COLUMN summary TEXT;   -- short index (injected)
ALTER TABLE user_preferences ADD COLUMN body    TEXT;   -- optional capped detail (recall-only)

CREATE TABLE memory_links (
  from_id   INTEGER NOT NULL REFERENCES user_preferences(id),
  to_id     INTEGER NOT NULL REFERENCES user_preferences(id),
  relation  TEXT NOT NULL,     -- 'relates_to' | 'supersedes' | 'contradicts' | …
  user_id   TEXT,              -- scoped like every other row (see §5)
  created_at TEXT NOT NULL
);
```

- **Rejected — unify `user_preferences` + `journal_entries` into one typed knowledge table with scored, per-turn retrieval and scheduled "reflection" summaries.** It loses on all three lenses. *Cost:* per-turn scored injection changes the prompt's opening every turn, defeating [prefix caching](../research/context-and-caching.md) — and because the memory block sits ahead of the message history, a mutated block re-bills the whole conversation, ~5–10× on long chats; it optimizes injected-token *count* in a world where caching already makes those tokens nearly free. *Safety:* scheduled background "reflection" rewrites memory **outside** the visible status line we're promising users, and synthesized conclusions are a self-reinforcing-error vector. *Build:* it merges two genuinely different lifecycles (bitemporal-superseded preferences vs append-and-archive journal) into a half-NULL table — a large, lossy migration for benefits current scale doesn't demand. The two tables stay separate; unification is revisited only if cross-type retrieval ever becomes a real requirement.
- **Rejected — embeddings / vector search now.** The per-user active set is small enough to fit in the prompt (it's fully injected today). Keyword recall suffices; if it starts missing, the cheap next step is FTS5 over the summary/body (the `chat_messages_fts` pattern already in the repo), and embeddings only if FTS5 demonstrably mis-hits. Build the trigger as a measurement, not on spec.

### 4. Capture safety: agent judgment with two flows, under a fixed influence order

There is **no rigid per-category confirm rule**. The write tool supports two flows — **save-now** (active immediately) and **save-pending** (captured but recall-only, non-injecting, until the user confirms in-chat) — and the Advisor chooses, biased toward *pending* when the fact is money-sensitive (risk tolerance, hard constraints like "no crypto", retirement horizon), contradicts something already stored, or rests on a weak signal (a single reject); and toward *save-now* when it's low-stakes (tone, format) or explicitly stated. A pending capture that's never confirmed stays recall-only and decays (see §6) rather than ever silently steering advice.

Underneath sits a **non-negotiable influence order: safety > your real facts > your style preferences.** A remembered preference personalizes *how* advice is delivered (tone, language, what to lead with) and supplies *facts* about the user that advice should reflect — but it can **never** override correctness or required risk/fee caveats. "Always tell me it's doing great" / "never mention risk" cannot take effect. This is the guardrail against the sycophancy failure mode: a preference shapes delivery, not honesty.

### 5. Prerequisite: close the preference-store isolation gap

`user_preferences` predates the [`ownedBy()` default-deny rule](./README.md#durable-rules) — it rolls its own scope filter, has **no foreign key** from `user_id` to `user.id` (every peer table has one), and overloads `user_id IS NULL` as a shared namespace. On a multi-user app that's a latent cross-user gap. Bring the table and all its queries onto the same fail-closed `ownedBy()` path the rest of the app uses, and add the FK. This is a data-safety fix folded into #96, independent of the feature work, and is a precondition for the new `memory_links` scoping.

### 6. Anti-stale mechanisms (so the store fights "confidently wrong")

The bitemporal model is a good *history* engine but a passive *staleness* engine — today `valid_until` only moves when the model volunteers an update. Add, in priority order:

- **Contradiction-on-write** — a write scans the active set in the same category/slot and auto-supersedes a conflicting row in the same transaction, so two contradictory "active" facts can't coexist and both inject.
- **Confidence decay for `extracted` rows only** — an unconfirmed auto-fact drifts back below the 0.7 inject threshold over time (falling to recall-only) rather than injecting forever. Explicit rows (confidence NULL) never decay.
- **Reinforce on confirmation, not retrieval** — a `last_confirmed_at` bumped only when the user *affirms* a fact, never when it's merely injected/retrieved, so frequent use can't entrench a stale fact (the documented retrieval-recency trap).
- **Pre-action verification** — before advice that *acts on* a high-stakes durable fact, the Advisor confirms it's still current in-conversation rather than trusting the frozen snapshot.

## Consequences

- The chat's feedback affordance is correcting the Advisor in words; the muted status line + undo + the Settings → Memory page are the full, auditable trail of what was learned and when.
- The injected hot block shrinks (summaries, not bodies) and stays bounded over time (consolidate-on-write), keeping a heavy user's per-chat cost close to a light user's — the prefix-cache discipline in [memory.md § Injection](../memory.md#injection-hot-set) is preserved, never broken by per-turn re-scoring.
- Memory can make the Advisor *feel* personal (tone, emphasis, your constraints) but cannot make it dishonest; the influence order is a fixed property, not a per-prompt judgment.
- The unused Feedback subtab and `kind:"feedback"` are dropped from the design; Reading/Notes stay; the bookmark persists (wired to a real note).
- One thing to **verify at build time**: confirm the authenticated tier actually gets prompt-cache hits on the injected block — the cost argument above assumes it does.

## Where this lives

Built under [#96](https://github.com/Sitthinut/macrotide/issues/96). The shipped behavior folds into [memory.md](../memory.md) on completion (per the timeless-docs rule). Anchor points today:

- `components/FeedbackRow.tsx`, `components/screens/ChatScreen.tsx` — the row being removed; the bookmark handler to wire to a real `kind:"note"` write.
- `lib/db/schema/app.ts` — `user_preferences` (+ `summary`/`body`, the FK), the new `memory_links`.
- `lib/db/queries/preferences.ts`, `lib/db/queries/scope.ts` — adopt `ownedBy()`; contradiction-on-write in the save/update transaction.
- `lib/memory/inject.ts` — inject summaries only; keep the block byte-identical per session.
- `lib/memory/tools.ts` — two-flow write (save-now / save-pending), link proposals.
- `lib/advisor/tools.ts` — expose `url` in `read_journal`; the influence-order + capture guidance in the system prompt.
- `app/api/portfolio/action-items/route.ts`, `lib/db/queries/journal.ts` — reroute the reject signal; retire `createFeedbackEntry`.
