# Explanation

Understanding-oriented background — the shape of the system and the reasoning
behind it. Read these to build a mental model, not to complete a task.

| Doc | Explains |
|---|---|
| [Product direction](./product-direction.md) | Why Macrotide exists: north star, who it's for, the Learn → Analyze → Research → Select loop, the index-purist stance, and success signals |
| [Architecture](./architecture.md) | The system's overall shape, the request lifecycle, owner/demo DB routing, and where every kind of code lives |
| [Balances and History](./balances-and-history.md) | How stating a Balance and logging a trade fit together — the one-ledger model, the cost-basis-delta math with worked examples, self-healing edits, and custom-asset pricing |
| [Design principles](./design-principles.md) | Secure-by-default, the "Advisor" voice, and the single-owner → multi-user evolution |

## Feature deep dives & research

| Doc | Role |
|---|---|
| [memory.md](./memory.md) | The long-term memory + chat-session lifecycle: storage, tools, injection, extraction |
| [advisor-context.md](./advisor-context.md) | What the Advisor knows on a turn — the three context channels, the per-entry-point contract, and the empty-turn recovery |
| [inference-strategy.md](./inference-strategy.md) | How the Advisor stays smart/fast/token-efficient — model routing, prompt caching, reasoning tokens, context loading, tool-result shaping; each lever mapped to the backlog |
| [research/memory-systems.md](./research/memory-systems.md) | The prior-art survey (Letta, Mem0, OpenViking, …) behind the memory design |
| [research/context-engineering.md](./research/context-engineering.md) | Prior-art survey on context engineering for tool-using agents — the Advisor loop, failure modes, recovery |
| [research/llm-platform-primitives.md](./research/llm-platform-primitives.md) | Prior-art survey: how providers expose tool calling, system prompts, reasoning tokens, citations/structured output |
| [research/context-and-caching.md](./research/context-and-caching.md) | Prior-art survey: prompt caching cost/latency math + context-window management / progressive loading |
| [research/agent-evals.md](./research/agent-evals.md) | Prior-art survey: how to evaluate a tool-using agent — the task/harness/grader triple, deterministic vs LLM-judge graders, `pass^k`, dead-end metrics; evidence behind `scripts/eval` |

A feature's deep dive lives here as a single doc; the research that informed it
sits beneath it in [research/](./research). Both are understanding-oriented, so
this is their home rather than [reference](../reference) (facts) or
[how-to](../how-to) (tasks).

> These `explanation/` docs carry a **Last updated** stamp because, unlike
> [reference](../reference), they describe intent and can quietly drift from
> the code. If a stamp looks old and the text disagrees with the code, trust
> the code and fix the doc.
