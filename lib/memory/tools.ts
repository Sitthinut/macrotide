// AI SDK tool surface for Phase 5a memory. Four tools exposed to the chat
// model; all delegate to the existing query layer at lib/db/queries/preferences.ts.
//
// Source attribution: in 5a the model invokes these tools on the user's
// behalf during a chat turn, so we record source = 'advisor_tool'. A future
// user-facing "Save this" button would record source = 'user_tool'.
//
// Confirmation copy follows AGENTS.md § Product copy & vocabulary
// — the AI is "Advisor", saved-but-not-yet-injected facts are "Active in
// your next chat" (frozen-for-the-session discipline; see memory.md).
import { tool } from "ai";
import { z } from "zod";
import {
  forget,
  isCategory,
  listActive,
  PREFERENCE_CATEGORIES,
  type Preference,
  recall,
  save,
  update,
} from "../db/queries/preferences";

const categoryEnum = z.enum(PREFERENCE_CATEGORIES);

function categoryLabel(category: string): string {
  switch (category) {
    case "profile":
      return "profile";
    case "finance_context":
      return "finance context";
    case "response_style":
      return "response style";
    case "fact":
      return "fact";
    default:
      return category;
  }
}

function formatCandidates(rows: Preference[]): string {
  return rows.map((r) => `  - [${r.id}] ${r.content}`).join("\n");
}

export interface MemoryToolOptions {
  // Pre-Phase-6 single owner: pass null. Phase 6 will thread the
  // authenticated user id through here.
  userId: string | null;
}

export function createMemoryTools({ userId }: MemoryToolOptions) {
  const save_preference = tool({
    description:
      "Save a durable preference about the user so it loads automatically " +
      "in future chats. Use when the user explicitly states a stable fact, " +
      "preference, account detail, or how they want Advisor to respond. " +
      "Choose the most specific category. The saved preference does NOT " +
      "affect the current chat — it activates in the next chat (frozen-" +
      "for-the-session injection). Confirm to the user with the returned " +
      "message.",
    inputSchema: z.object({
      category: categoryEnum.describe(
        "Which bucket the preference belongs to. profile = stable facts " +
          "about the user (risk tolerance, time horizon, timezone, age). " +
          "finance_context = accounts, tax situation, constraints. " +
          "response_style = how Advisor should communicate. fact = " +
          "one-off ad-hoc remembers.",
      ),
      content: z
        .string()
        .min(1)
        .max(500)
        .describe(
          "The fact to remember, written as a short declarative phrase " +
            "(e.g. 'risk tolerance: moderate', 'no individual stocks, " +
            "funds only', 'be concise; skip disclaimers').",
        ),
    }),
    execute: async ({ category, content }) => {
      const row = save({
        userId,
        category,
        content,
        source: "advisor_tool",
      });
      return {
        ok: true as const,
        id: row.id,
        category: row.category,
        message: `Saved: ${content}. Active in your next chat.`,
      };
    },
  });

  const update_preference = tool({
    description:
      "Update an existing preference. Pass either the numeric id (from a " +
      "previous list_preferences call) or a distinctive substring of the " +
      "current content. If the substring matches more than one active " +
      "preference, the tool returns the candidates so you can ask the " +
      "user to clarify before retrying.",
    inputSchema: z.object({
      id_or_substring: z
        .string()
        .min(1)
        .describe(
          "Numeric id (e.g. '42') or a distinctive substring of the " +
            "existing content (e.g. 'retirement age').",
        ),
      new_content: z
        .string()
        .min(1)
        .max(500)
        .describe("The replacement content for the preference."),
    }),
    execute: async ({ id_or_substring, new_content }) => {
      const result = update(userId, id_or_substring, new_content);
      if (result.kind === "none") {
        return {
          ok: false as const,
          reason: "not_found" as const,
          message:
            `I couldn't find an active preference matching "${id_or_substring}". ` +
            "Try list_preferences to see what's saved.",
        };
      }
      if (result.kind === "ambiguous") {
        return {
          ok: false as const,
          reason: "ambiguous" as const,
          candidates: (result.candidates ?? []).map((r) => ({
            id: r.id,
            category: r.category,
            content: r.content,
          })),
          message:
            `I found multiple matches for "${id_or_substring}":\n` +
            `${formatCandidates(result.candidates ?? [])}\n` +
            "Ask the user which one to update, then call update_preference " +
            "again with the specific id.",
        };
      }
      const oldRow = result.oldRow;
      const newRow = result.newRow;
      return {
        ok: true as const,
        old_id: oldRow?.id,
        new_id: newRow?.id,
        category: newRow?.category,
        message: `Updated: "${oldRow?.content}" → "${newRow?.content}". Active in your next chat.`,
      };
    },
  });

  const forget_preference = tool({
    description:
      "Forget (soft-delete) a preference so it no longer loads in future " +
      "chats. Pass either the numeric id or a distinctive substring. " +
      "The row stays for 30 days in case the user changes their mind " +
      "(restorable from Settings → Memory). If the substring is " +
      "ambiguous, the tool returns the candidates so you can disambiguate.",
    inputSchema: z.object({
      id_or_substring: z
        .string()
        .min(1)
        .describe("Numeric id or a distinctive substring of the content."),
    }),
    execute: async ({ id_or_substring }) => {
      const result = forget(userId, id_or_substring);
      if (result.kind === "none") {
        return {
          ok: false as const,
          reason: "not_found" as const,
          message:
            `I couldn't find an active preference matching "${id_or_substring}". ` +
            "Try list_preferences to see what's saved.",
        };
      }
      if (result.kind === "ambiguous") {
        return {
          ok: false as const,
          reason: "ambiguous" as const,
          candidates: (result.candidates ?? []).map((r) => ({
            id: r.id,
            category: r.category,
            content: r.content,
          })),
          message:
            `I found multiple matches for "${id_or_substring}":\n` +
            `${formatCandidates(result.candidates ?? [])}\n` +
            "Ask the user which one to forget, then call forget_preference " +
            "again with the specific id.",
        };
      }
      const row = result.row;
      return {
        ok: true as const,
        id: row?.id,
        category: row?.category,
        message:
          `Forgotten: ${row?.content}. It won't load in future chats ` +
          "(restorable from Settings → Memory for 30 days).",
      };
    },
  });

  const list_preferences = tool({
    description:
      "List the user's active preferences. Optionally filter by category. " +
      "Useful before update_preference / forget_preference when you need " +
      "the id of an existing row, or when the user asks 'what do you " +
      "remember about me'.",
    inputSchema: z.object({
      category: categoryEnum.optional().describe("Optional: restrict to one category."),
    }),
    execute: async ({ category }) => {
      const filter = category && isCategory(category) ? category : undefined;
      const rows = listActive(userId, filter);
      return {
        ok: true as const,
        count: rows.length,
        rows: rows.map((r) => ({
          id: r.id,
          category: r.category,
          content: r.content,
        })),
        message:
          rows.length === 0
            ? filter
              ? `No active preferences in ${categoryLabel(filter)}.`
              : "No active preferences saved yet."
            : `${rows.length} active preference${rows.length === 1 ? "" : "s"}` +
              (filter ? ` in ${categoryLabel(filter)}.` : "."),
      };
    },
  });

  const recall_preferences = tool({
    description:
      "Recall saved preferences relevant to a topic. This is the cold-recall " +
      "complement to the always-on memory block: the active preferences are " +
      "already injected at the top of the conversation, so use this only when " +
      "you need to look something up that may not be top-of-mind — e.g. the " +
      "user asks 'what did I tell you about my taxes?' or you want to check " +
      "for a relevant constraint before answering. Matches active preferences " +
      "by keyword (any word in the query). Returns the matching rows; if " +
      "nothing matches, say so plainly rather than guessing.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          "Free-text topic or keywords to search saved preferences for " +
            "(e.g. 'retirement age', 'tax', 'how should you respond').",
        ),
    }),
    execute: async ({ query }) => {
      const rows = recall(userId, query);
      return {
        ok: true as const,
        count: rows.length,
        rows: rows.map((r) => ({
          id: r.id,
          category: r.category,
          content: r.content,
        })),
        message:
          rows.length === 0
            ? `No saved preferences match "${query}".`
            : `${rows.length} saved preference${rows.length === 1 ? "" : "s"} match "${query}":\n` +
              formatCandidates(rows),
      };
    },
  });

  return {
    save_preference,
    update_preference,
    forget_preference,
    list_preferences,
    recall_preferences,
  };
}

export type MemoryTools = ReturnType<typeof createMemoryTools>;
