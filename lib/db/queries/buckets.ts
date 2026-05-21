import { eq } from "drizzle-orm";
import { getDb } from "../context";
import { buckets } from "../schema";

export type Bucket = typeof buckets.$inferSelect;
export type BucketInsert = typeof buckets.$inferInsert;
export type BucketUpdate = Partial<Omit<BucketInsert, "id" | "createdAt">>;

export function listBuckets(): Bucket[] {
  return getDb().select().from(buckets).orderBy(buckets.createdAt).all();
}

export function getBucket(id: string): Bucket | undefined {
  return getDb().select().from(buckets).where(eq(buckets.id, id)).get();
}

export function createBucket(input: BucketInsert): Bucket {
  return getDb().insert(buckets).values(input).returning().get();
}

export function updateBucket(id: string, patch: BucketUpdate): Bucket | undefined {
  return getDb()
    .update(buckets)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(buckets.id, id))
    .returning()
    .get();
}

export function deleteBucket(id: string): void {
  getDb().delete(buckets).where(eq(buckets.id, id)).run();
}
