import { eq } from "drizzle-orm";
import { getDb } from "../context";
import { holdings } from "../schema";

export type Holding = typeof holdings.$inferSelect;
export type HoldingInsert = typeof holdings.$inferInsert;
export type HoldingUpdate = Partial<Omit<HoldingInsert, "id" | "createdAt">>;

export function listHoldings(bucketId?: string): Holding[] {
  const q = getDb().select().from(holdings);
  return (bucketId ? q.where(eq(holdings.bucketId, bucketId)) : q).all();
}

export function getHolding(id: number): Holding | undefined {
  return getDb().select().from(holdings).where(eq(holdings.id, id)).get();
}

export function createHolding(input: HoldingInsert): Holding {
  return getDb().insert(holdings).values(input).returning().get();
}

export function updateHolding(id: number, patch: HoldingUpdate): Holding | undefined {
  return getDb()
    .update(holdings)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(holdings.id, id))
    .returning()
    .get();
}

export function deleteHolding(id: number): void {
  getDb().delete(holdings).where(eq(holdings.id, id)).run();
}
