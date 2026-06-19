# Memory

Macrotide's Advisor remembers what you tell it across chats — your goals, risk
tolerance, accounts, response preferences — so you never re-explain yourself.
Memory is:

- **Real-time** — the Advisor saves a fact the moment you state it, mid-chat. No
  background job, no waiting.
- **Visible** — every write shows a muted status line with an **Undo** right
  there in the chat, and every stored entry is on the **Journal → Memory** page
  with its source, validity window, and a delete button. Nothing is hidden in
  embeddings.
- **Feedback is correction, not a rating** — you shape the Advisor by correcting
  it in words ("actually I prefer funds only"), which becomes a remembered memory;
  there is no 👍/👎 bar. See [ADR 0006](./decisions/0006-feedback-by-memory.md).
- **Bitemporal** — updating a fact adds a new row and supersedes the old one;
  history is kept, never silently overwritten.
- **Self-maintaining** — on each write the Advisor reconciles against what's
  already saved (add / update / skip) instead of piling up near-duplicates.
- **Bounded** — a small active set loads into every chat; the long tail is
  recalled on demand, so the prompt stays small and cheap.

For *why* the design looks this way — the prior-art survey and the build-vs-adopt
decision — see [the memory-systems research](./research/memory-systems.md).

## Using memory

### Saving

Tell the Advisor something durable — *"remember I'm targeting
retirement at 50"* or *"don't suggest individual stocks, I only do funds."* It
calls `save_preference`, and a quiet status line under the reply — *"Memory
saved"* — records it; click it to see what changed or jump to manage it. You can
also bookmark any Advisor reply (the bookmark at the foot of a message) to keep
it as a journal note.

Captures save immediately and are always visible and deletable — there's no
hidden "held" state. The safety net is the Advisor's fixed influence order
(safety > facts > style): a remembered fact can shape *how* advice reads but
never override an honest risk/fee caveat, so a misheard memory is visible and
harmless rather than silently steering advice.

### Loading

At the start of every chat, your active preferences load into the Advisor's
context automatically. You don't restate them. To see exactly what's loaded,
open **Journal → Memory**.

### Updating

*"Actually, change that to age 55"* calls `update_preference`: the
old row is stamped with an end date and a new row takes its place (and any links
re-point to the new row in the same transaction). On the Memory page, memories
aren't edited in a text box — that would lose the provenance trail; instead
**Edit** opens a fresh chat where the *Advisor* asks what you'd like to change,
then captures your answer like any other correction. It only acts once you've
said what to change — there's no synthesized "change it" turn to act on
prematurely. The memory's full `content` and longer `body` ride along as hidden
context on your reply (never shown in the bubble or the chat title), so the
Advisor targets the right memory and sees the whole of it, not just the short
`content` line.

### Confirming

When you re-affirm a fact — *"yes, still funds only"* — the Advisor calls
`confirm_preference`, which records the affirmation (`last_confirmed_at`). That
reinforcement is what keeps a fact reading as current and resists decay (below).

### Forgetting

*"Forget the retirement age thing"* calls `forget_preference` —
the row is end-dated and never injected again, but kept for audit. The Memory
page also has a per-row delete (→ 30-day trash → hard delete) and an inline
**Undo** on the in-chat status line right after a write.

### Auto-saved memories

When a chat ends (see [Sessions](#sessions-and-continuity)),
the Advisor scans it for durable facts you stated and saves them as
`extracted` memories with a confidence score, attributed to the source chat so you
can trace and correct them. Low-confidence memories are kept for recall but not
auto-loaded.

### Seeing and editing everything

Journal → Memory lists every active entry
grouped by category, shows recently-forgotten memories with a restore button, and
lets you forget or ask the Advisor to change one. It is the single source of
truth for "what does the Advisor know about me?"

## Sessions and continuity

Macrotide uses **discrete chats**, not one infinite thread. Each chat is a
session with a natural shape — a rebalance discussion, a tax question, a quick
check-in. Durable facts survive across them in memory; each new chat starts
fresh with that memory loaded.

### Lifecycle

| State | Meaning | Transitions |
|---|---|---|
| `active` | The chat you're in. | → `idle` when the session closes (below). |
| `idle` | Closed, recent. Full history kept. | → `active` when you reopen it and send a message. |
| `archived` | Older idle chat, grouped separately in the sidebar. | → `active` on resume. |
| `trashed` | Deleted — a separate axis from the states above (set via `deletedAt`, not `status`): soft-delete with a 30-day restore window, then hard-removed. | restore within 30 days. |

### What "closing a session" means

A session **closes** when you move on — start a New Chat, switch to another
thread, or close the window/tab. On close the Advisor, in real time:

1. **Extracts durable facts** from the conversation into memory (the auto-saved
   memories above), and
2. marks the chat `idle`.

There's no timer — closing is driven by what you actually do. (A background
sweep closes any session you abandoned without a clean exit, e.g. a crashed tab,
so nothing is missed.)

### Resuming

Reopen an idle or archived chat and send a message, and it becomes
`active` again. The next time it closes, only the **new** turns are extracted —
the Advisor reuses the running summary of earlier turns as context rather than
re-reading the whole transcript. So resuming a chat any number of times never
re-does old work.

### Long chats stay affordable

If a chat grows past ~80% of the context budget, the Advisor summarizes the
older turns and sends that summary in their place — the model's *input view*
shrinks, but **no message is ever deleted** from the chat. A banner tells you
this happened. This keeps a 50-turn chat from costing dramatically more than a
short one.

The "budget" is a fixed conservative constant (`DEFAULT_CONTEXT_BUDGET_TOKENS`,
32k, in `lib/ai/summarize.ts`) — a safe floor across the varied public-tier
OpenRouter models, *not* read from the live model's actual window. Token use is
estimated with a chars/4 heuristic (no tokenizer dependency). Both the budget
and the 0.8 threshold are overridable per call via `compressContext()`; the chat
route uses the defaults.

### Sidebar

The chat sidebar lists sessions grouped by recency (Today / Yesterday /
Previous 7 days / older), with:

- **New Chat** (`⌘/Ctrl+K`) and **full-text search** across your chats.
- **Auto-titling** — after the first exchange, a cheap model writes a 3–5 word
  title (a model chosen for cost, not Claude/GPT-class).
- Per-row **rename / delete**, an active-session indicator, and a persistent
  *"Advisor is AI and can make mistakes."* disclaimer under the input.
- On mobile the sidebar collapses to a drawer.

## Under the hood

### Storage

One bitemporal table, SQLite, owned by the user (scoped by `user_id` once
multi-user lands):

```sql
CREATE TABLE user_preferences (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           TEXT REFERENCES user(id),  -- NULL = shared/owner; demo & built-in rows
  category          TEXT NOT NULL,     -- enum, see below
  content           TEXT NOT NULL,     -- the fact, as a short injected line
  summary           TEXT,              -- optional shorter line to inject instead of content
  body              TEXT,              -- optional longer detail, recall-only (never injected)
  status            TEXT NOT NULL DEFAULT 'active',  -- vestigial; always 'active' (held-"pending" lane was dropped)
  source            TEXT NOT NULL,     -- 'user_tool' | 'advisor_tool' | 'extracted'
  source_session_id TEXT,              -- chat_threads.id (provenance)
  source_turn_ids   TEXT,              -- JSON array of chat_messages.id
  confidence        REAL,              -- NULL for explicit (trusted), 0..1 for extracted
  valid_from        TEXT NOT NULL,     -- UTC ISO-8601
  valid_until       TEXT,              -- UTC ISO-8601; NULL = active
  last_confirmed_at TEXT,              -- bumped on affirmation (reinforcement; gates decay)
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

-- Typed relationships between memories (e.g. a constraint and the correction that
-- set it). Integrity is enforced by the schema, not the model: both ends FK to
-- user_preferences, and reads join on validity so a link to a superseded row
-- drops out rather than dangling.
CREATE TABLE memory_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT REFERENCES user(id),
  from_id    INTEGER NOT NULL REFERENCES user_preferences(id),
  to_id      INTEGER NOT NULL REFERENCES user_preferences(id),
  relation   TEXT NOT NULL,            -- 'relates_to' | 'supersedes' | 'contradicts' | …
  created_at TEXT NOT NULL
);
```

The active set is always `WHERE valid_until IS NULL AND status = 'active'`.
Updates insert a new row and end-date the old one in one transaction; nothing is
mutated in place, and any `memory_links` re-point to the new row in that same
transaction. Timestamps are UTC; the UI renders them in the user's timezone
(itself a `profile` row).

`user_preferences` is scoped fail-closed: queries default to the request user
via `ownedBy()` (see `lib/db/queries/scope.ts`) rather than threading a `userId`
parameter, and inserts stamp the owner. A logged-in user can never read or write
another user's memories, and demo sessions get their own in-memory namespace.

Chat sessions live in `chat_threads`, which carries the lifecycle columns:
`status` (`active`/`idle`/`archived`), `archived_at`, `deleted_at` (trash), and
`extracted_through_id` — the **incremental-extraction watermark**: the highest
message id already folded into an extraction pass, so a re-close only processes
newer turns.

### Categories

A small fixed enum drives both the injection budget and the Journal → Memory grouping:

| Category | What lives here | Example |
|---|---|---|
| `profile` | Stable facts about the user | risk tolerance, time horizon, age, timezone |
| `finance_context` | Accounts, tax situation, constraints | "401k at Fidelity", "Thai tax resident", "funds only" |
| `response_style` | How the Advisor should communicate | "be concise", "show percentages not dollars" |
| `fact` | Other durable one-offs | "wife's name is Sarah" |

### Tool surface

Seven tools, exposed to the chat model via the Vercel AI SDK shape used across
`app/api/chat/`:

| Tool | Args | Purpose |
|---|---|---|
| `save_preference` | `{ category, content, detail? }` | Save a new durable fact (active immediately). `detail` → recall-only `body`. |
| `update_preference` | `{ id_or_substring, new_content, detail? }` | Supersede a fact with a new value. |
| `forget_preference` | `{ id_or_substring }` | End-date a fact (kept for audit). |
| `confirm_preference` | `{ id_or_substring }` | Reinforce a re-affirmed fact (`last_confirmed_at`; resists decay). |
| `link_preferences` | `{ from_id, to_id, relation }` | Record a typed relationship between two memories. |
| `list_preferences` | `{ category? }` | List active facts. |
| `recall_preferences` | `{ query, limit? }` | Cold-recall the long tail — including low-confidence extracted memories the always-on block omits. |

`update`/`forget`/`confirm` match by `id`, then by a unique `content` substring
(erroring with candidates if ambiguous) — short, natural tool calls. Each write
tool also returns a structured `memoryEvent` the chat UI turns into the muted
status line + Undo; the natural-language `message` is for the model.

The Advisor operates under a fixed influence order — **safety > facts > style**:
a preference shapes *how* advice is delivered, never whether the Advisor is
honest, and high-stakes durable facts are verified before being acted on
(anti-sycophancy floor; see [ADR 0006](./decisions/0006-feedback-by-memory.md)).

### Injection (hot set)

Active preferences render into the system prompt at session start and are
**frozen for the session** — writes during a chat take effect on the *next*
chat. This preserves the prefix cache (the block is byte-identical across turns,
deterministically ordered) and avoids jarring mid-session behavior shifts. The
inline status line records the write so the user understands the change lands
next chat. Each line renders `summary ?? content` (the short `summary` when set,
else the full `content`); the longer `body` is never injected.

```text
## Your stored preferences

### Profile
- risk tolerance: moderate
- time horizon: 10–15 years

### Finance context
- no individual stocks (funds only)

### Response style
- be concise; skip disclaimers
```

Empty categories are omitted. Per-category token budgets (≈300 profile / 500
finance_context / 200 response_style / 500 fact, ~1500 total) cap the block;
beyond that the long tail is reached via `recall_preferences`.

### Confidence floor

Explicit rows (`confidence` NULL) always inject.
Auto-`extracted` rows inject only at `confidence ≥ 0.7`; below that they're
recall-only — saved and searchable, never auto-loaded.

### Session close and incremental extraction

The real-time close path is `closeSession` (`lib/memory/session-close.ts`),
invoked by `POST /api/chat/threads/[id]/close` — fired client-side on New Chat,
thread switch, and `pagehide` (via `sendBeacon`, so it survives the window
closing). A client dirty-flag gates it: the beacon only fires when there's *new*
conversation, so a refresh or a read-only revisit never spends a model call.

`closeSession`:

1. No-ops unless the thread is `active` (idempotent — a chat extracts once per
   close, never twice).
2. Extracts only turns past `extracted_through_id`, giving the cheap extractor
   the **running summary** as compressed context for what came before.
3. Strips the Advisor's own injected memory block from the transcript first, so
   re-injected facts aren't "re-learned" (recursive-pollution guard).
4. **Reconciles** each candidate against the memories already saved (passed to the
   extractor as delimited, untrusted data): the model returns an `op` —
   **add** a new memory, **update** an existing one (by id), or **skip** a
   duplicate — in a single pass (the mem0 token-efficient pattern). Target ids
   are validated in code, an `update` is held to the trust-tier guard below, and
   a candidate that *contradicts* an explicit memory is **skipped** rather than
   silently overriding it.
5. Saves facts with `source='extracted'` + confidence + provenance, then
   advances the watermark and marks the thread `idle`.

Resuming reactivates the thread (`idle → active`) so the next close extracts the
new turns — incrementally, from the watermark. The extractor model is the cheap
tier (`EXTRACT_MODELS` → `TITLE_MODELS` → `openrouter/free`), and a background
`closeStaleSessions` sweep (`lib/jobs/close-stale-sessions.ts`) closes any
session abandoned without a clean exit and hard-deletes trashed threads whose
30-day restore window has expired.

### Trust tiers and consolidation

Two rules keep the store self-maintaining without letting automation quietly
rewrite what you said explicitly:

- **Trust-tier guard.** An `extracted` memory may only supersede another
  `extracted` memory — it can never overwrite an explicit (`user_tool` /
  `advisor_tool`) fact. An extraction that conflicts with an explicit memory is
  **skipped** (the explicit memory stands; the user can change it via the Advisor),
  never applied silently (`updateFromExtraction` enforces this in code).
- **Consolidate-on-write — model first.** The real defence against duplicates is
  the Advisor checking before it saves. The injected memory block is a *frozen*
  snapshot from the start of the chat, so it can't show a memory saved earlier in
  the **same** session; the system prompt therefore tells the Advisor to call
  `list_preferences`/`recall_preferences` (which query the **live** set) before
  `save_preference`, and to `update_preference` an existing memory rather than add a
  near-duplicate — the same "check memory first, prefer editing over creating"
  pattern Anthropic's memory tool bakes into its system prompt. Semantic
  consolidation stays the model's job (and the extraction reconcile's), because
  free-text memories are almost never byte-identical.
- **Idempotency net.** Below that, `save()` itself collapses a *truly identical*
  re-save: an active memory with the same category and content (trimmed,
  case-insensitive) returns the existing row instead of inserting a copy. This is
  only a cheap backstop for the degenerate case (a model re-saving the exact same
  line within a frozen session) — it does nothing for near-duplicates, which is
  why the model-side check above is the primary mechanism.

### Decay and staleness

A background `jobs:decay-extracted` sweep (`lib/jobs/decay-extracted.ts`) nudges
`source='extracted'` rows' confidence down over time, so an inferred memory that's
never reinforced eventually drops below the 0.7 inject floor and becomes
recall-only — it **decays the score, not the data** (the row is kept, still
searchable). Explicit rows (`confidence` NULL) never decay. `last_confirmed_at`
is bumped only on **affirmation**, not on retrieval, so a frequently-recalled
stale fact doesn't entrench itself. The job iterates per user scope with
`runWithUserScope` (it must never run against the bare owner namespace).

### Demo mode

Demo sessions route to a per-session in-memory SQLite, so preferences persist
for the demo and vanish when it ends — no special handling.

### Where it lives

```text
lib/db/schema/app.ts                     user_preferences + memory_links + chat_threads
lib/db/queries/preferences.ts            CRUD + ownedBy() scope + recall + reconcile + links + decay
lib/db/queries/scope.ts                  ownedBy()/ownerId() fail-closed scoping
lib/db/queries/chat.ts                   threads, lifecycle, summary rows
lib/db/queries/search.ts                 sidebar full-text search (FTS5)
lib/memory/inject.ts                     render the hot block + confidence floor + summary
lib/memory/tools.ts                      AI SDK tool definitions + memoryEvent
lib/memory/extract.ts                    incremental fact extraction + reconcile (add/update/skip)
lib/memory/session-close.ts              close = extract + mark idle
lib/ai/summarize.ts                      mid-chat context compression
lib/jobs/close-stale-sessions.ts         backstop sweep
lib/jobs/decay-extracted.ts              extracted-only confidence decay
app/api/chat/route.ts                    inject at start; reactivate on resume
app/api/chat/threads/[id]/close/route.ts real-time close endpoint
app/api/memory/preferences/route.ts      Journal → Memory data (active + recently forgotten)
components/screens/ChatScreen.tsx        chat UI + close triggers + memory status line + undo
components/MemoryNotes.tsx               Journal → Memory subtab (browse / forget / restore / edit)
components/ChatThreadList.tsx            sidebar: sessions, search, actions
```

Multi-user note: every memory and session query is scoped fail-closed by
`ownedBy()`; that scoping is invariant — no tool call may surface another user's
data.
