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
// Wave A scope: backend only. The Journal-feedback signal a "Not for me" should
// write, and the Hidden-checks UI that consumes GET, are Wave B.

import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import {
  type ActionItemState,
  clearActionItemState,
  listHidden,
  recordActionItem,
} from "@/lib/db/queries/action-items";

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

  return withDb(() =>
    NextResponse.json(
      recordActionItem({
        // biome-ignore lint/style/noNonNullAssertion: validated above
        itemType: body.itemType!,
        // biome-ignore lint/style/noNonNullAssertion: validated above
        itemKey: body.itemKey!,
        state,
        reason,
        snapshotSavingsPp,
      }),
      { status: 201 },
    ),
  );
}

export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  return withDb(() => {
    clearActionItemState(key);
    return NextResponse.json({ ok: true });
  });
}
