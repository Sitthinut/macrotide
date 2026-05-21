import { eq } from "drizzle-orm";
import { db } from "../client";
import { settings } from "../schema";

export function getSetting<T = unknown>(key: string): T | undefined {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value as T | undefined;
}

export function setSetting(key: string, value: unknown): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    })
    .run();
}

export function listSettings(): Array<{ key: string; value: unknown }> {
  return db.select().from(settings).all();
}

export function deleteSetting(key: string): void {
  db.delete(settings).where(eq(settings.key, key)).run();
}
