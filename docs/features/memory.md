# Memory

Macrotide's Advisor remembers what you tell it across chats — your goals, risk
tolerance, accounts, response preferences — so you never re-explain yourself.
Memory is:

- **Real-time** — the Advisor saves a fact the moment you state it, mid-chat. No
  background job, no waiting.
- **Visible** — every stored entry is on the **Settings → Memory** page with its
  source, validity window, and a delete button. Nothing is hidden in embeddings.
- **Bitemporal** — updating a fact adds a new row and supersedes the old one;
  history is kept, never silently overwritten.
- **Bounded** — a small active set loads into every chat; the long tail is
  recalled on demand, so the prompt stays small and cheap.

For *why* the design looks this way — the prior-art survey and the build-vs-adopt
decision — see [the memory-systems research](../research/memory-systems.md).

---

## Using memory

**Saving.** Tell the Advisor something durable — *"remember I'm targeting
retirement at 50"* or *"don't suggest individual stocks, I only do funds."* It
calls `save_preference` and an inline card confirms: *"Saved: targeting
retirement at 50."*

**Loading.** At the start of every chat, your active preferences load into the
Advisor's context automatically. You don't restate them. To see exactly what's
loaded, open **Settings → Memory**.

**Updating.** *"Actually, change that to age 55"* calls `update_preference`: the
old row is stamped with an end date and a new row takes its place. The Memory
page shows both, the old one marked superseded.

**Forgetting.** *"Forget the retirement age thing"* calls `forget_preference` —
the row is end-dated and never injected again, but kept for audit. The Memory
page also has a per-row delete (→ 30-day trash → hard delete).

**Auto-saved notes.** When a chat ends (see [Sessions](#sessions-and-continuity)),
the Advisor scans it for durable facts you stated and saves them as
`extracted` notes with a confidence score, attributed to the source chat so you
can trace and correct them. Low-confidence notes are kept for recall but not
auto-loaded.

**Seeing and editing everything.** Settings → Memory lists every active entry
grouped by category, shows superseded history, and lets you delete or restore.
It is the single source of truth for "what does the Advisor know about me?"

---

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
   notes above), and
2. marks the chat `idle`.

There's no timer — closing is driven by what you actually do. (A background
sweep closes any session you abandoned without a clean exit, e.g. a crashed tab,
so nothing is missed.)

**Resuming.** Reopen an idle or archived chat and send a message, and it becomes
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
32k, in `lib/ai/summarize.ts`) — a safe floor across the varied free-tier
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

---

## Under the hood

### Storage

One bitemporal table, SQLite, owned by the user (scoped by `user_id` once
multi-user lands):

```sql
CREATE TABLE user_preferences (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           TEXT,              -- NULL for the single owner today
  category          TEXT NOT NULL,     -- enum, see below
  content           TEXT NOT NULL,     -- the fact, as prose
  source            TEXT NOT NULL,     -- 'user_tool' | 'advisor_tool' | 'extracted'
  source_session_id TEXT,              -- chat_threads.id (provenance)
  source_turn_ids   TEXT,              -- JSON array of chat_messages.id
  confidence        REAL,              -- NULL for explicit (trusted), 0..1 for extracted
  valid_from        TEXT NOT NULL,     -- UTC ISO-8601
  valid_until       TEXT,              -- UTC ISO-8601; NULL = active
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
```

The active set is always `WHERE valid_until IS NULL`. Updates insert a new row
and end-date the old one in one transaction; nothing is mutated in place.
Timestamps are UTC; the UI renders them in the user's timezone (itself a
`profile` row).

Chat sessions live in `chat_threads`, which carries the lifecycle columns:
`status` (`active`/`idle`/`archived`), `archived_at`, `deleted_at` (trash), and
`extracted_through_id` — the **incremental-extraction watermark**: the highest
message id already folded into an extraction pass, so a re-close only processes
newer turns.

### Categories

A small fixed enum drives both the injection budget and the Settings grouping:

| Category | What lives here | Example |
|---|---|---|
| `profile` | Stable facts about the user | risk tolerance, time horizon, age, timezone |
| `finance_context` | Accounts, tax situation, constraints | "401k at Fidelity", "Thai tax resident", "funds only" |
| `response_style` | How the Advisor should communicate | "be concise", "show percentages not dollars" |
| `fact` | Other durable one-offs | "wife's name is Sarah" |

### Tool surface

Five tools, exposed to the chat model via the Vercel AI SDK shape used across
`app/api/chat/`:

| Tool | Args | Purpose |
|---|---|---|
| `save_preference` | `{ category, content }` | Save a new durable fact. |
| `update_preference` | `{ id_or_substring, new_content }` | Supersede a fact with a new value. |
| `forget_preference` | `{ id_or_substring }` | End-date a fact (kept for audit). |
| `list_preferences` | `{ category? }` | List active facts. |
| `recall_preferences` | `{ query, limit? }` | Cold-recall the long tail — including low-confidence extracted notes the always-on block omits. |

`update`/`forget` match by `id`, then by a unique `content` substring (erroring
with candidates if ambiguous) — short, natural tool calls.

### Injection (hot set)

Active preferences render into the system prompt at session start and are
**frozen for the session** — writes during a chat take effect on the *next*
chat. This preserves the prefix cache (the block is byte-identical across turns,
deterministically ordered) and avoids jarring mid-session behavior shifts. The
inline save card says *"Saved"* so the user understands the change lands next
chat.

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

**Confidence floor.** Explicit rows (`confidence` NULL) always inject.
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
4. Saves facts with `source='extracted'` + confidence + provenance, then
   advances the watermark and marks the thread `idle`.

Resuming reactivates the thread (`idle → active`) so the next close extracts the
new turns — incrementally, from the watermark. The extractor model is the cheap
tier (`EXTRACT_MODEL` → `TITLE_MODEL` → `openrouter/free`), and a background
`closeStaleSessions` sweep (`lib/jobs/close-stale-sessions.ts`) closes any
session abandoned without a clean exit.

### Demo mode

Demo sessions route to a per-session in-memory SQLite, so preferences persist
for the demo and vanish when it ends — no special handling.

### Where it lives

```text
lib/db/schema.ts                         user_preferences + chat_threads
lib/db/queries/preferences.ts            CRUD + active-filter + recall
lib/db/queries/chat.ts                   threads, lifecycle, summary rows
lib/db/queries/search.ts                 sidebar full-text search (FTS5)
lib/memory/inject.ts                     render the hot block + confidence floor
lib/memory/tools.ts                      AI SDK tool definitions
lib/memory/extract.ts                    incremental fact extraction
lib/memory/session-close.ts              close = extract + mark idle
lib/ai/summarize.ts                      mid-chat context compression
lib/jobs/close-stale-sessions.ts         backstop sweep
app/api/chat/route.ts                    inject at start; reactivate on resume
app/api/chat/threads/[id]/close/route.ts real-time close endpoint
components/screens/ChatScreen.tsx        chat UI + close triggers + banner
components/ChatThreadList.tsx            sidebar: sessions, search, actions
```

Multi-user note: every memory and session query filters by `user_id`; that
filter is invariant — no tool call may surface another user's data.
