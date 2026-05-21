import { eq } from "drizzle-orm";
import { db } from "../client";
import { holdings } from "../schema";

export type Holding = typeof holdings.$inferSelect;
export type HoldingInsert = typeof holdings.$inferInsert;
export type HoldingUpdate = Partial<Omit<HoldingInsert, "id" | "createdAt">>;

export function listHoldings(bucketId?: string): Holding[] {
  const q = db.select().from(holdings);
  return (bucketId ? q.where(eq(holdings.bucketId, bucketId)) : q).all();
}

export function getHolding(id: number): Holding | undefined {
  return db.select().from(holdings).where(eq(holdings.id, id)).get();
}

export function createHolding(input: HoldingInsert): Holding {
  return db.insert(holdings).values(input).returning().get();
}

export function updateHolding(id: number, patch: HoldingUpdate): Holding | undefined {
  return db
    .update(holdings)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(holdings.id, id))
    .returning()
    .get();
}

export function deleteHolding(id: number): void {
  db.delete(holdings).where(eq(holdings.id, id)).run();
}
