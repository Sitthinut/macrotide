// POST /api/portfolio/action-items — record an Archive / "Not for me" on a
// generated Portfolio action item (fee-creep flags today). The state is keyed by
// a deterministic item_key (see lib/portfolio/action-item-key.ts) so it survives
// reloads. GET returns the current owner's hidden set; DELETE restores an item.
//
// Two honest actions (#74): 'archived' (filed) and 'not_for_me' (rejected, with
// an optional reason chip or free text). Snooze is dropped. On record we snapshot
// the finding's current magnitude (savingsPp) so the resurface check has a
// baseline and the ratchet re-baselines on re-suppression.
//
// A "Not for me" also writes a Journal ▸ Feedback entry (kind:"feedback") in the
// same withDb transaction, so the rejection — with its reason — is reviewable in
// the Journal and feeds the Advisor's "don't repeat rejected advice" context.

import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import {
  type ActionItemState,
  clearActionItemState,
  listHidden,
  recordActionItem,
} from "@/lib/db/queries/action-items";
import { createFeedbackEntry } from "@/lib/db/queries/journal";
import { isReasonChip } from "@/lib/portfolio/action-item-resurface";

// Human-readable labels for the reason chips, used in the Journal feedback note.
const REASON_CHIP_LABELS: Record<string, string> = {
  too_small: "Too small to matter",
  tax_switching: "Tax & switching cost",
  prefer_this_fund: "I prefer this fund",
  already_considered: "Already considered",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATES: ReadonlyArray<ActionItemState> = ["archived", "not_for_me"];
const VALID_ITEM_TYPES = ["headline", "rebalance", "fee_creep"] as const;

export async function GET() {
  return withDb(() => NextResponse.json({ hidden: listHidden() }));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    itemType?: string;
    itemKey?: string;
    state?: string;
    reason?: string | null;
    savingsPp?: number | null;
    /** Human-readable label for the Journal feedback topic (e.g. "Fee check — K-FIXED-A"). */
    topic?: string | null;
  } | null;

  if (!body || typeof body.itemKey !== "string" || body.itemKey.length === 0) {
    return NextResponse.json({ error: "itemKey is required" }, { status: 400 });
  }
  if (!(VALID_ITEM_TYPES as readonly string[]).includes(body.itemType ?? "")) {
    return NextResponse.json({ error: "invalid itemType" }, { status: 400 });
  }
  if (!(VALID_STATES as readonly string[]).includes(body.state ?? "")) {
    return NextResponse.json({ error: "invalid state" }, { status: 400 });
  }

  const state = body.state as ActionItemState;
  // Reason is free-form (a chip key or "Other…" free text); only kept on a reject.
  const reason =
    state === "not_for_me" && typeof body.reason === "string" && body.reason.length > 0
      ? body.reason
      : null;
  // Snapshot the magnitude the client saw; only finite numbers are stored.
  const snapshotSavingsPp =
    typeof body.savingsPp === "number" && Number.isFinite(body.savingsPp) ? body.savingsPp : null;

  // biome-ignore lint/style/noNonNullAssertion: validated above
  const itemType = body.itemType!;
  // biome-ignore lint/style/noNonNullAssertion: validated above
  const itemKey = body.itemKey!;
  const topic = typeof body.topic === "string" && body.topic.length > 0 ? body.topic : itemKey;

  return withDb(() => {
    const row = recordActionItem({ itemType, itemKey, state, reason, snapshotSavingsPp });

    // A rejection writes a Journal feedback entry (rating "down") in the same
    // transaction. The note prefers the chip's human label, falling back to the
    // free text the user typed. A no-reason reject still records the topic.
    if (state === "not_for_me") {
      const note = reason ? (isReasonChip(reason) ? REASON_CHIP_LABELS[reason] : reason) : null;
      createFeedbackEntry({ topic, rating: "down", note, source: "action_item" });
    }

    return NextResponse.json(row, { status: 201 });
  });
}

export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  return withDb(() => {
    clearActionItemState(key);
    return NextResponse.json({ ok: true });
  });
}
