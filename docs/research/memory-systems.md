# Agent memory systems — a prior-art survey

A developer-facing survey of how production and open-source agent-memory
systems were storing, writing, and retrieving long-term memory as of May 2026.
It exists to record the prior art that informed macrotide's own memory design,
and to keep that reasoning legible after the fact.

> **Provenance.** This document reconstructs research carried out by a team of
> scout agents in May 2026. The Hermes section comes from `WebFetch` against the
> official Nous Research docs; OpenHuman from reading the
> `tinyhumansai/openhuman` repo directly via the GitHub API (file paths are
> cited inline); OpenClaw from the `coolmanns/openclaw-memory-architecture`
> README plus web search; the rest from a 2025–2026 web survey. Where a claim
> couldn't be verified beyond a single secondary source, that is flagged. Source
> URLs are linked per-section.

---

## Hermes Agent (Nous Research)

**What it is.** A local-first agent harness with a deliberately minimal,
file-based core memory and a pluggable provider system for anything heavier.

**Memory model.** Two plain Markdown files in `~/.hermes/memories/`:

- `MEMORY.md` — the agent's own operational notes (environment facts, project
  conventions, learned techniques, a completed-task diary). Cap: **2,200 chars
  / ~800 tokens**.
- `USER.md` — the user profile (name, timezone, comms preferences, skill level,
  pet peeves). Cap: **1,375 chars / ~500 tokens**.

Entries inside each file are delimited by `§`. No database, no vectors, no
embeddings at the core layer. Categorisation is purely target-level (`memory`
vs `user`); there is no further tagging.

Writes are **agent-driven, not auto-extracted**. The model "saves automatically
when it learns" — a preference, a correction, an environment fact — or on an
explicit user instruction ("Remember that…"). There is no background
conversation scraper; the LLM makes intentional save decisions.

Retrieval is a **"frozen snapshot"**: both files are rendered into the system
prompt at session start and **never mutate mid-session** — explicitly to
preserve the LLM prefix cache. In-session writes hit disk but don't appear in
context until the next session.

Pruning is by **hard char cap**. When a file is full the tool errors and dumps
current entries so the agent can consolidate. The docs advise: *"When memory is
above 80% capacity… consolidate entries before adding new ones,"* and give an
explicit "skip these" list — *"Trivial/obvious info"*, *"Easily re-discovered
facts."*

The tool surface is a single `memory` tool with three actions — `add`,
`replace`, `remove` — and notably **no `read`** (memory is always injected).
`replace`/`remove` match on a short unique **substring** rather than full text,
which lowers edit friction. A separate `session_search` tool gives **FTS5**
full-text search over all prior CLI/messaging sessions stored in SQLite —
forming a deliberate two-tier system: a bounded always-on prompt memory plus
unlimited on-demand historical recall.

The **provider** layer sits above the built-in files. Exactly one external
provider can be active at a time, with lifecycle hooks for context injection,
non-blocking per-turn prefetch, post-turn sync, end-of-session extraction,
mirroring of built-in writes, and tool exposure. Backends span local
(Holographic = SQLite; ByteRover = hierarchical tree; OpenViking = filesystem),
cloud (Honcho, Mem0, RetainDB, Supermemory), and hybrid (Hindsight). Two
provider details worth noting: Supermemory *"strips recalled memories from
captured turns to prevent recursive memory pollution"* (avoiding the loop where
re-injected memories get re-saved), and ByteRover does *"pre-compression
extraction"* that "saves insights before context compression discards them."

**The one idea worth stealing.** Frozen-snapshot injection as a *cache
discipline* — accept that in-session writes won't be visible until next session,
in exchange for a stable prompt prefix. Plus the two-tier split: a tiny
always-injected core, with FTS recall for everything else.

Sources:
[memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory),
[memory-providers](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers).

---

## OpenHuman (tinyhumansai/openhuman)

**What it is.** A Rust desktop "personal AI" with one of the more serious
open-source memory implementations surveyed. Its centrepiece is the **Memory
Tree** — a deterministic hierarchical-summary pipeline, explicitly *not* a vector
database with a thin memory wrapper.

**Memory model.** Local-first SQLite at `<workspace>/memory_tree/chunks.db` (the
unified store carries **FTS5 keyword search + vector embeddings + graph
relations** in one), plus an Obsidian-compatible Markdown vault at
`<workspace>/wiki/`. The backend contract is the `Memory` trait
(`src/openhuman/memory/traits.rs`); the canonical row is
`MemoryEntry { id, key, content, namespace, category, timestamp, session_id,
score }`. Categories are `Core | Daily | Conversation | Custom(String)`.

From the feature doc (`gitbooks/features/obsidian-wiki/memory-tree.md`), the
pipeline is:

```
source adapters (chat / email / document)
  → canonicalize   (normalised Markdown + provenance metadata)
  → chunker        (deterministic IDs, ≤3k-token bounded segments)
  → content_store  (atomic .md files on disk)
  → store          (chunks, scores, summaries, jobs)
  → score          (signals + embeddings + entity extraction)
  → source / topic / global trees
  → retrieval      (search / drill_down / topic / global / fetch)
```

It builds **three concurrent summary trees** from the same leaf stream:

- **Source trees** — a per-source rolling buffer (L0) that seals into L1 → L2 …
  as it fills. One per Gmail label, Slack channel, uploaded document, etc.
- **Topic trees** — per-entity summaries materialised lazily by **hotness**: the
  more an entity (person, project, ticker, repo) recurs, the more aggressively
  its tree is built and refreshed.
- **Global tree** — one daily digest across everything ingested that day.

Writes are mostly **automatic and LLM-free on the hot path**: canonicalize →
chunk → fast-score → persist in a single transaction → enqueue follow-up. The
heavy work (embeddings, entity extraction, sealing buckets, daily digests) runs
in **background workers** off a durable on-disk queue, so the UI never blocks.
A chunk's lifecycle is orthogonal to its category: `pending_extraction →
admitted → buffered → sealed | dropped`.

Retrieval is two-track: the `Memory` trait offers blended keyword+vector+
freshness `recall` (with a `RecallOpts.cross_session` flag that surfaces
episodic hits from *other* sessions in the same workspace — workspace == user is
the hard boundary), and the tree side offers scope-selectable `search /
drill_down / topic / global / fetch`.

Pruning *is* the bucket-seal mechanism: L0 buffers fill and seal into L1
summaries that cascade upward; a `flush_stale` job force-seals idle buffers; a
daily UTC scheduler enqueues the global digest.

The doc's own justification for trees over vectors is worth quoting:

> "Vector stores answer 'what is similar to this query?' Memory needs to answer
> more than that … Trees give you compression *and* navigation. Embeddings still
> live inside so semantic search keeps working, but the structure on top is what
> makes the memory feel like a brain instead of a bag of fragments."

One more notable choice: the backend is **pluggable**. Setting
`backend = "agentmemory"` in `config.toml` short-circuits the SQLite+embedder
path and proxies every trait call (`store`, `recall`, `get`, `list`, `forget`,
`namespace_summaries`, `count`, `health_check`) to a self-hosted
[agentmemory](https://github.com/rohitg00/agentmemory) REST daemon — so Claude
Code, Cursor, Codex, OpenCode, and OpenHuman can share one durable store.

**The one idea worth stealing.** A deterministic, LLM-free hot path with all the
expensive work deferred to background workers — cost stays bounded under burst —
plus hierarchical summary trees that give you both compression and navigation
rather than a flat similarity search.

Source: [github.com/tinyhumansai/openhuman](https://github.com/tinyhumansai/openhuman)
(repo read directly; file paths cited inline).

---

## OpenClaw — 12-layer memory architecture

**What it is.** OpenClaw is an open-source agent framework (Peter Steinberger,
Nov 2025; originally "Clawdbot"), runnable over Discord/Telegram/web and
powerable by Claude models. The core framework ships **no** memory layer; the
de-facto community standard is the
[`coolmanns/openclaw-memory-architecture`](https://github.com/coolmanns/openclaw-memory-architecture)
spec — a 12-layer system whose tagline is that *"agents reconstruct themselves
from files on every boot."*

**Memory model.** Its thesis is explicitly **anti-monoculture** — *"Don't rely on
one approach. Use the right memory layer for each type of recall"*:

- "What's my daughter's birthday?" → **structured lookup** (instant, exact)
- "What did we decide about the database?" → **decision fact** (instant, exact)
- "What happened last week with the deployment?" → **semantic search** (fuzzy)

The layers, roughly:

- A **Lossless Context Engine** (`lcm.db`) stores all messages, builds a summary
  DAG, and assembles the context window from the DAG plus live messages (with an
  FTS index).
- **Always-loaded workspace files** — `MEMORY.md`, `USER.md`, `SOUL.md`,
  `AGENTS.md` — injected at 0-token-cost-to-compute on every boot. This is the
  "reconstruct from files" idea.
- A structured **`facts.db`** holding entities, relations, aliases, and **decay
  tiers**.
- A **continuity archive** with embeddings (nomic, 768-d), topics, and anchors.
- **LightRAG on PostgreSQL** / GraphRAG for domain RAG; `llama.cpp` for local
  embeddings.
- **Metacognitive plugins** (main-agent only): Metabolism (fact extraction),
  Stability (entropy / growth vectors), Contemplation (a multi-pass deep-inquiry
  background job).

A single `memory_search` tool **fans out across four backends in parallel**
(continuity / facts / files / lcm) and returns one merged result — the agent
makes one call, not four.

The README is candid about the limitation it's fighting: the underlying memory
is *"fundamentally session-scoped and compaction-dependent — when context
windows fill up, information gets summarized, which means detail loss."*

**The one idea worth stealing.** A single retrieval tool that fans out to
several specialised stores in parallel and merges — the model gets one ergonomic
entry point while each backend does what it's best at (exact KV vs FTS vs
vector).

Sources:
[coolmanns/openclaw-memory-architecture](https://github.com/coolmanns/openclaw-memory-architecture),
[robotpaper.ai reference architecture](https://robotpaper.ai/reference-architecture-openclaw-early-feb-2026-edition-opus-4-6/),
[VentureBeat on OpenClaw + Anthropic](https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch).

---

## mem0

**What it is.** A managed/open-source memory *layer* that bolts onto an existing
chat loop; the write path is invisible and retrieval is the API.

**Memory model.** Three storage layers — **vector + graph + key-value** — under a
four-(plus-one)-scope model: `user_id`, `agent_id`, `run_id`, `app_id`, plus
optional `org_id`. Memories are **extracted automatically from conversation in
the background** and stored against whichever scopes apply.

Retrieval blends **semantic similarity + keyword + entity matching + time
filters in a single query** (the graph-enhanced variant adds traversal). At the
start of a new session, relevant memories are retrieved and injected before the
model responds.

Reported benchmarks (secondary source): on **LOCOMO**, mem0 hits 66.9% accuracy
at 0.71s median latency with ~1,800 tokens/conversation; the graph variant
`mem0g` reaches 68.4% at 1.09s. Its 2026 algorithm's biggest gains were on
temporal queries (+29.6 pts) and multi-hop reasoning (+23.1 pts).

**The one idea worth stealing.** A lean, opinionated managed layer where the
write is fully out-of-band — the application never thinks about *when* to save,
only *how* to query. (The flip side, and a reason macrotide went the other way:
the write is **opaque** to the end user.)

Sources:
[mem0.ai/blog/state-of-ai-agent-memory-2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026),
[github.com/mem0ai/mem0](https://github.com/mem0ai/mem0).

---

## Letta / MemGPT

**What it is.** The OS-as-metaphor system from the MemGPT paper, productised as
Letta. Memory is a hierarchy modelled on a computer's memory pyramid, and the
agent **manages its own memory** through tool calls.

**Memory model.** Three tiers:

- **Core memory** — always in-context, like RAM. The agent edits it live.
- **Recall memory** — searchable conversation history kept outside context,
  like a disk cache.
- **Archival memory** — long-term external store queried by tool call, like cold
  storage (embedding-backed).

The agent moves information between tiers by **explicitly calling functions** —
`core_memory_append`, `core_memory_replace` (edit in-context memory),
`conversation_search` (recall), and `archival_memory_insert` /
`archival_memory_search` (the external store). This is the **self-editing /
agent-as-memory-manager** pattern: the model is an active participant in
curating its own memory, not a passive recipient of injected context. The write
is on the **hot path**, decided by the model.

**The one idea worth stealing.** The clean RAM / disk-cache / cold-storage
mental model, and treating "what's in context right now" as something the model
edits with first-class tools rather than something the framework decides behind
its back.

Sources:
[docs.letta.com — MemGPT agents (legacy)](https://docs.letta.com/guides/legacy/memgpt_agents_legacy).

---

## Zep (Graphiti)

**What it is.** A production temporal-knowledge-graph memory layer; its open
engine is **Graphiti** (Apache 2.0). Its distinguishing bet is **bitemporality**
— it knows not just *what* a fact is, but *when it was true*.

**Memory model.** A temporal graph of entities, relationships, and facts, where
**each fact carries a validity window**. Graphiti records **dual timelines**:

- `t_valid` — when the fact became true, and
- `t_invalid` — when it was superseded.

The canonical example from the research: a customer-service AI hears "I moved to
Taipei" on Monday and "I moved to Kaohsiung" on Wednesday. Zep automatically
marks the first fact `t_invalid` on Wednesday and the second `t_valid` from
Wednesday — **contradicted edges are auto-invalidated rather than overwritten**,
so history is preserved and "what did we believe last Tuesday?" remains
answerable.

> "Unlike traditional knowledge graphs, each fact in a context graph has a
> validity window: when it became true, and when (if ever) it was superseded."

Reported benchmark (secondary source): Zep scored **63.8% on LongMemEval** vs
mem0's 49.0%, and the vendor emphasises SOC 2 / HIPAA / GDPR compliance as a
selling point into finance/medical/legal.

**The one idea worth stealing.** Bitemporal validity — never mutate a fact in
place; supersede it with a validity window so the system can reconstruct what was
true at any point. This is the single most directly relevant idea to a finance
app, where "your risk tolerance as of March" matters.

Sources:
[Zep: A Temporal Knowledge Graph Architecture for Agent Memory (arXiv 2501.13956)](https://arxiv.org/abs/2501.13956),
[github.com/getzep/graphiti](https://github.com/getzep/graphiti),
[getzep.com](https://www.getzep.com/).

---

## LangMem

**What it is.** LangChain's memory framework — not a store but a set of
**storage-agnostic primitives** you compose with any backend (with native
LangGraph integration available).

**Memory model.** Two core primitive families, both implemented as pure functions
over memory state (no side effects, no DB dependency):

- **Memory Managers** — extract new memories, update/remove outdated ones, and
  consolidate or generalise from existing ones based on new conversation.
- **Prompt Optimizers** — update prompt rules and core behaviour from
  conversation signal.

Crucially, LangMem offers **both** write paths and refuses to pick one for you:
agent-accessible **hot-path tools** for recording/searching memories *during* a
conversation, **and** a **background memory manager** that extracts, consolidates,
and enriches *outside* the conversation flow.

**The one idea worth stealing.** "Don't pick a database, pick primitives" — keep
the extract/update/consolidate logic as pure functions decoupled from storage,
so the same logic runs on the hot path or in a background job.

Sources:
[langchain-ai.github.io/langmem](https://langchain-ai.github.io/langmem/),
[LangMem SDK launch](https://www.langchain.com/blog/langmem-sdk-launch),
[github.com/langchain-ai/langmem](https://github.com/langchain-ai/langmem).

---

## Cognee

**What it is.** A graph-vector hybrid built around an ingestion **pipeline** that
turns raw documents into a knowledge graph layered with embeddings, with an
offline self-improvement pass.

**Memory model.** A six-stage pipeline: classify documents → check permissions →
extract chunks → use an LLM to extract entities and relationships → generate
summaries → embed everything into the vector store and commit edges to the graph
(graph and vector index built in parallel, producing subject-relation-object
triplets). It separates **session memory** (short-term working set loaded into
runtime context) from the durable graph.

Its distinctive feature is **`memify`**, a post-ingestion pass that *"prunes
stale nodes, strengthens frequent connections, reweights edges based on usage
signals, and adds derived facts"* — i.e. memory is an evolving structure that
adapts from feedback, not static storage. Cognee ships **14 retrieval modes**,
from classic RAG to chain-of-thought graph traversal, and runs locally on
SQLite (relational) + LanceDB (vector) + Kuzu (graph) with no external services.

**The one idea worth stealing.** `memify` — an explicit offline consolidation
step that reweights and prunes the memory graph by usage, rather than letting it
grow monotonically.

Sources:
[cognee.ai — how Cognee builds AI memory](https://www.cognee.ai/blog/fundamentals/how-cognee-builds-ai-memory),
[best AI agent memory systems 2026 (vectorize.io)](https://vectorize.io/articles/best-ai-agent-memory-systems).

---

## Anthropic memory tool

**What it is.** A built-in tool for Claude (Managed Agents, public beta as of
2026) that gives agents a persistent **filesystem** of memory across sessions —
the simplest possible store, with the intelligence kept in the agent loop.

**Memory model.** Memories are **files on a filesystem** (a memory directory,
typically Markdown). Claude can **create, read, update, and delete** files via
the tool, and they persist between sessions; developers can export, edit, and
manage them via API or in the Console. Writes are agent-driven (a CRUD tool
call), not background extraction.

Guidance emphasises **keeping memory lean** — store only what's essential for
every session, push project-specific knowledge into separate docs referenced on
demand, and remember that the aggregate size of loaded memory files directly
costs context and can degrade performance.

A May 2026 addition called **"dreaming"** has the agent review past sessions
**offline** to find patterns and self-improve (reported via secondary sources;
treat specifics as preliminary).

**The one idea worth stealing.** Boring files + an offline consolidation pass:
the store is as simple as it can be (CRUD over files), the cleverness lives in
the agent loop and a periodic offline review — and "keep memory lean" is an
explicit, enforced design value.

Sources:
[Memory tool — Claude API docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool),
[Anthropic — advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use),
[9to5Mac on the May 2026 updates](https://9to5mac.com/2026/05/07/anthropic-updates-claude-managed-agents-with-three-new-features/).

---

## OpenViking (context note)

Surveyed alongside the above because it is the clearest example of the
"filesystem paradigm" trend and shows up as a Hermes provider. **OpenViking** is
a [Volcengine (ByteDance Cloud) project](https://github.com/volcengine/OpenViking)
(AGPLv3) that bills itself as a *Context Database for AI Agents*. It abandons the
flat vector blob and exposes memory, resources, and skills as a virtual
filesystem under `viking://`, navigable with `ls` / `read` / `find`. Context is
loaded in three tiers — **L0 summary (~100 tok) → L1 overview (~2k) → L2 raw** —
so the agent budgets tokens deterministically rather than gambling on top-k. It
requires both a VLM (for extraction) and an embedding model (for fallback
semantic search), and ships a Claude Code MCP plugin. The takeaway: deterministic,
tiered, navigable context as an alternative to probabilistic similarity search.

Sources:
[github.com/volcengine/OpenViking](https://github.com/volcengine/OpenViking),
[OpenViking explained (Medium)](https://medium.com/@techlatest.net/openviking-explained-reinventing-memory-and-context-for-ai-agents-c189b2bea61b).

---

## Cross-cutting: consensus and live disagreements

Reading across the systems, a few things had clearly converged by 2026, and a
few were still genuinely contested.

**Where the field agreed:**

- **Hybrid stores won.** The vector-vs-graph argument is largely settled in
  favour of "both": vectors for semantic entry-point retrieval, a graph for
  multi-hop relational depth, plus a short-term episodic buffer. mem0, Cognee,
  OpenHuman, and OpenClaw all ship some flavour of this. (One nuance from the
  research: on single-hop factual lookup, GraphRAG can *under*-perform vanilla
  RAG — graphs pay off as query complexity rises, at ~2–3× the retrieval latency.)
- **Retrieval matters more than write strategy.** On the LoCoMo benchmark,
  accuracy spanned ~20 points across *retrieval* methods but only 3–8 points
  across *write* strategies — i.e. how you read back matters more than how you
  wrote.
- **Bounded hot context + on-demand cold recall** is the recurring shape:
  Hermes (core files + `session_search`), Letta (core + archival), Anthropic
  (lean memory + external docs), OpenHuman (always-on recall + tree drill-down).

**Where they still disagreed:**

- **Hot-path vs background writes.** Letta and the Hermes/Anthropic tool models
  write on the hot path (the agent decides inline); mem0 and "enterprise-grade"
  architectures push extraction to async background jobs to keep conversational
  latency at zero. LangMem refuses to choose and ships both. The trade is
  latency-and-control vs simplicity-and-recall-quality.
- **User-visible vs opaque memory.** Hermes/Anthropic/OpenHuman expose memory as
  files/vaults a human can read and edit; mem0 and Letta's stores are largely
  opaque to the end user (you query them, you don't browse them).
- **Tool-call vs implicit injection** as the way memory enters context.

---

## Patterns macrotide adopted

macrotide is a single-VM, SQLite, TypeScript personal finance advisor — no
Python sidecar, no vector service, a small and structured memory surface. That
constraint set, plus the survey above, pointed to a deliberately small design
that borrows specific ideas rather than adopting any one framework wholesale.

**1. Inject hot, recall cold.** The active set of durable facts loads into the
chat system prompt at session start (always-on), and a recall tool covers the
long tail of older or archived-chat notes. This is the cross-framework consensus
shape — Hermes's core-files + `session_search`, Letta's core + archival,
Anthropic's lean memory + external docs — adapted to a small bounded prompt plus
on-demand recall. The injected block follows **Hermes's frozen-snapshot cache
discipline**: it is built once per session and held identical across turns to
preserve the prefix cache, accepting that within-session writes won't be visible
until the next session.

**2. Bitemporal validity — two columns, not a graph.** Durable facts live in a
`user_preferences` table with `valid_from` / `valid_until` columns. **Updates add
a new row and supersede the old one; nothing is mutated in place**, and
`valid_until IS NULL` is the active set. This is **Zep's bitemporal model
deliberately simplified** — the value of "what was true when, and what
superseded it" without the cost of a full temporal knowledge graph. It matters
in a finance context specifically: "I switched from aggressive to moderate risk
tolerance" should supersede the old fact with a validity window, not erase it.

**3. Visible, auditable writes.** Every entry is shown to the user — content,
category, source, validity window, and a delete control — on a Settings → Memory
page, with supersession surfaced rather than hidden. This is the
files/vault-visible side of the field (Hermes, Anthropic, OpenHuman's Obsidian
vault) and a conscious rejection of the **opaque** write path in mem0 and Letta.
Each row also records its provenance: who saved it (`user_tool` / `advisor_tool`,
with `extracted` reserved for any later background extraction), the originating
session, the source turns, and a nullable `confidence` (NULL for explicit tool
calls, which are always trusted).

**4. Model-driven, real-time saves.** Saving is an explicit **tool call the model
makes in the moment** — "remember I'm targeting retirement at 50" → the advisor
calls a save tool → the next session knows it. This follows the
Hermes/Letta/Anthropic "agent decides what to remember" pattern (a hot-path
write) rather than mem0-style opaque background extraction, keeping the write
both auditable and immediate. Edits use **substring matching** (Hermes's
ergonomic touch) rather than requiring exact full text.

In short: macrotide took **inject-hot/recall-cold** and **frozen-snapshot cache
discipline** from the Hermes/Letta/Anthropic consensus, **bitemporal validity**
from Zep (as two columns, not a graph), **visible/auditable provenance** as a
reaction against opaque stores, and **model-driven hot-path writes** as the save
trigger — implemented as a handful of typed tools over a single SQLite table
rather than any external memory framework.
