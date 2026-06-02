// Integration contract for the #74 Wave-B feedback wiring + demo write path.
//
// A "Not for me" rejection on a fee-creep card writes BOTH a suppression row
// (recordActionItem) and a Journal feedback entry (createFeedbackEntry), and the
// adapter reads that entry back into a FeedbackItem for the Journal ▸ Feedback
// subtab. We exercise the real query layer against a fresh in-memory app.db via
// runWithDbContext — including the demo path (isDemo: true), which is the write
// path the route uses for a demo session.

import { describe, expect, it } from "vitest";
import { adaptJournal } from "@/lib/portfolio/adapter";
import { makeTestDbContext } from "@/tests/db-helpers";
import { runWithDbContext } from "../context";
import { listHidden, recordActionItem } from "./action-items";
import { createFeedbackEntry, listJournalEntries } from "./journal";

function inDemoDb<T>(fn: () => T): T {
  return runWithDbContext(makeTestDbContext({ isDemo: true, sessionId: "s1" }), fn) as T;
}

describe("createFeedbackEntry → adaptJournal", () => {
  it("stores a feedback entry that the adapter reads back as a FeedbackItem", () => {
    const journal = inDemoDb(() => {
      createFeedbackEntry({
        topic: "Fee check — EXAMPLE-FUND-A",
        rating: "down",
        note: "Tax & switching cost",
        source: "action_item",
      });
      return adaptJournal(listJournalEntries({ kind: "feedback" }));
    });

    expect(journal.feedback).toHaveLength(1);
    expect(journal.feedback[0]).toMatchObject({
      topic: "Fee check — EXAMPLE-FUND-A",
      rating: "down",
      note: "Tax & switching cost",
    });
    // A feedback entry must NOT leak into notes.
    expect(journal.notes).toHaveLength(0);
  });

  it("a no-reason reject still records a feedback entry with an empty note", () => {
    const journal = inDemoDb(() => {
      createFeedbackEntry({ topic: "No-reason reject", rating: "down", note: null });
      return adaptJournal(listJournalEntries());
    });
    expect(journal.feedback[0].rating).toBe("down");
    expect(journal.feedback[0].note).toBe("");
  });

  it("records an 'up' rating round-trip", () => {
    const journal = inDemoDb(() => {
      createFeedbackEntry({ topic: "Agreed thing", rating: "up", note: "" });
      return adaptJournal(listJournalEntries({ kind: "feedback" }));
    });
    expect(journal.feedback[0].rating).toBe("up");
  });
});

describe("action-item rejection write path (the route's shape)", () => {
  it("a 'not_for_me' records a suppression row AND a feedback entry together", () => {
    const result = inDemoDb(() => {
      // Mirror the route: record the suppression, then the feedback entry.
      recordActionItem({
        itemType: "fee_creep",
        itemKey: "fee_creep:EXAMPLE-FUND-A",
        state: "not_for_me",
        reason: "prefer_this_fund",
        snapshotSavingsPp: 0.42,
      });
      createFeedbackEntry({
        topic: "Fee check — EXAMPLE-FUND-A",
        rating: "down",
        note: "I prefer this fund",
        source: "action_item",
      });
      return {
        hidden: listHidden(),
        feedback: adaptJournal(listJournalEntries({ kind: "feedback" })).feedback,
      };
    });

    expect(result.hidden).toHaveLength(1);
    expect(result.hidden[0]).toMatchObject({
      itemKey: "fee_creep:EXAMPLE-FUND-A",
      state: "not_for_me",
      reason: "prefer_this_fund",
      snapshotSavingsPp: 0.42,
    });
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0].topic).toBe("Fee check — EXAMPLE-FUND-A");
    expect(result.feedback[0].rating).toBe("down");
  });

  it("an Archive records a suppression row but NO feedback entry", () => {
    const result = inDemoDb(() => {
      recordActionItem({
        itemType: "fee_creep",
        itemKey: "fee_creep:EXAMPLE-FUND-B",
        state: "archived",
        snapshotSavingsPp: 0.3,
      });
      return {
        hidden: listHidden(),
        feedback: adaptJournal(listJournalEntries({ kind: "feedback" })).feedback,
      };
    });
    expect(result.hidden).toHaveLength(1);
    expect(result.hidden[0].state).toBe("archived");
    expect(result.feedback).toHaveLength(0);
  });
});
