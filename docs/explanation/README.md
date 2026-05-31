# Explanation

Understanding-oriented background — the shape of the system and the reasoning
behind it. Read these to build a mental model, not to complete a task.

| Doc | Explains |
|---|---|
| [Product direction](./product-direction.md) | Why Macrotide exists: north star, who it's for, the Learn → Analyze → Research → Select loop, the index-purist stance, and success signals |
| [Architecture](./architecture.md) | The system's overall shape, the request lifecycle, owner/demo DB routing, and where every kind of code lives |
| [Design principles](./design-principles.md) | Secure-by-default, the "Advisor" voice, and the single-owner → multi-user evolution |

## Feature deep dives & research

| Doc | Role |
|---|---|
| [memory.md](./memory.md) | The long-term memory + chat-session lifecycle: storage, tools, injection, extraction |
| [advisor-context.md](./advisor-context.md) | What the Advisor knows on a turn — the three context channels, the per-entry-point contract, and the empty-turn recovery |
| [research/memory-systems.md](./research/memory-systems.md) | The prior-art survey (Letta, Mem0, OpenViking, …) behind the memory design |
| [research/context-engineering.md](./research/context-engineering.md) | Prior-art survey on context engineering for tool-using agents — the Advisor loop, failure modes, recovery |

A feature's deep dive lives here as a single doc; the research that informed it
sits beneath it in [research/](./research). Both are understanding-oriented, so
this is their home rather than [reference](../reference) (facts) or
[how-to](../how-to) (tasks).

> These `explanation/` docs carry a **Last updated** stamp because, unlike
> [reference](../reference), they describe intent and can quietly drift from
> the code. If a stamp looks old and the text disagrees with the code, trust
> the code and fix the doc.
