// POST /api/portfolio/action-items — record a dismiss / snooze / disagree on a
// generated Portfolio action item (fee-creep flags today). The state is keyed by
// a deterministic item_key (see lib/portfolio/action-item-key.ts) so it survives
// reloads. GET returns the current owner's suppression set; DELETE restores an
// item (un-dismiss / un-snooze).
//
// Snooze duration is a whitelisted token (7d / 30d / 90d) resolved to an absolute
// snoozeUntil SERVER-SIDE — never trust a client timestamp.

import { NextResponse } from "next/server";
import { withDb } from "@/lib/api/with-db";
import {
  type ActionItemState,
  clearActionItemState,
  listActionItemStates,
  listSuppressed,
  setActionItemState,
} from "@/lib/db/queries/action-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATES: ReadonlyArray<ActionItemState> = ["dismissed", "snoozed", "disagreed"];
const VALID_ITEM_TYPES = ["headline", "rebalance", "fee_creep"] as const;

// Whitelisted snooze durations → days. Closed set so a client can't pick an
// arbitrary window.
const SNOOZE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

function snoozeUntilFrom(token: string | undefined): string | null {
  if (!token) return null;
  const days = SNOOZE_DAYS[token];
  if (days === undefined) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function GET() {
  return withDb(() =>
    NextResponse.json({ suppressed: listSuppressed(), all: listActionItemStates() }),
  );
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    itemType?: string;
    itemKey?: string;
    state?: string;
    snoozeDuration?: string;
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
  let snoozeUntil: string | null = null;
  if (state === "snoozed") {
    snoozeUntil = snoozeUntilFrom(body.snoozeDuration);
    if (snoozeUntil === null) {
      return NextResponse.json(
        { error: "snooze requires a valid snoozeDuration (7d / 30d / 90d)" },
        { status: 400 },
      );
    }
  }

  return withDb(() =>
    NextResponse.json(
      setActionItemState({
        // biome-ignore lint/style/noNonNullAssertion: validated above
        itemType: body.itemType!,
        // biome-ignore lint/style/noNonNullAssertion: validated above
        itemKey: body.itemKey!,
        state,
        snoozeUntil,
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
