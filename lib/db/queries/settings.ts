import "server-only";
import { eq } from "drizzle-orm";
import { getDb, getUserId } from "../context";
import { settings } from "../schema";

export function getSetting<T = unknown>(key: string): T | undefined {
  const row = getDb().select().from(settings).where(eq(settings.key, key)).get();
  return row?.value as T | undefined;
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    })
    .run();
}

export function listSettings(): Array<{ key: string; value: unknown }> {
  return getDb().select().from(settings).all();
}

export function deleteSetting(key: string): void {
  getDb().delete(settings).where(eq(settings.key, key)).run();
}

/**
 * The key for a setting private to the current user: `<name>:<userId>[:<sub>]`,
 * with `owner` in place of the id when no user is in context (single-owner,
 * `AUTH_DISABLED`). The user id comes right after the name, so one user's key
 * can never equal another's whatever `sub` holds.
 */
export function userSettingKey(name: string, sub?: string): string {
  const base = `${name}:${getUserId() ?? "owner"}`;
  return sub === undefined ? base : `${base}:${sub}`;
}
