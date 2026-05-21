import { eq } from "drizzle-orm";
import { getDb } from "../context";
import { plans } from "../schema";

export type Plan = typeof plans.$inferSelect;

const PLAN_ID = 1; // single-row table for v1

export function getPlan(): Plan | undefined {
  return getDb().select().from(plans).where(eq(plans.id, PLAN_ID)).get();
}

export function upsertPlan(input: { markdown: string; selectedModelId?: string | null }): Plan {
  const now = new Date().toISOString();
  return getDb()
    .insert(plans)
    .values({
      id: PLAN_ID,
      markdown: input.markdown,
      selectedModelId: input.selectedModelId ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: plans.id,
      set: {
        markdown: input.markdown,
        selectedModelId: input.selectedModelId ?? null,
        updatedAt: now,
      },
    })
    .returning()
    .get();
}
