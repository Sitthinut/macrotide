import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { appDb } from "@/lib/db/client";
import {
  account as accountTable,
  passkey as passkeyTable,
  user as userTable,
} from "@/lib/db/schema";
import { UNLINK_LOCKOUT_CODE } from "./account-rules";
import { auth } from "./index";
import { isPlaceholderEmail } from "./placeholder-email";

// Drives better-auth's real /unlink-account endpoint, with macrotide's account
// hooks, against the per-worker test app.db (tests/setup-db.ts).

async function userWithGoogle() {
  const email = `unlink-${randomUUID()}@example.test`;
  const { headers: setCookie, response } = await auth.api.signUpEmail({
    body: { email, name: "Unlink Test", password: randomBytes(24).toString("base64url") },
    returnHeaders: true,
  });
  const cookie = setCookie
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const userId = response.user.id;
  const ctx = await auth.$context;
  const google = await ctx.internalAdapter.createAccount({
    userId,
    providerId: "google",
    accountId: `google-sub-${randomUUID()}`,
  });
  return { userId, google, headers: new Headers({ cookie }) };
}

function addPasskey(userId: string) {
  appDb
    .insert(passkeyTable)
    .values({
      id: randomUUID(),
      publicKey: "test-public-key",
      userId,
      credentialID: randomUUID(),
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: new Date(),
    })
    .run();
}

function googleRows(userId: string) {
  return appDb
    .select()
    .from(accountTable)
    .where(eq(accountTable.userId, userId))
    .all()
    .filter((a) => a.providerId === "google");
}

describe("unlinkAccount", () => {
  it("refuses to remove the only sign-in method, with the lockout code", async () => {
    const { userId, google, headers } = await userWithGoogle();

    const err = await auth.api
      .unlinkAccount({ body: { accountId: google.id }, headers })
      .then(() => null)
      .catch((e: { body?: { code?: string; message?: string } }) => e);

    expect(err?.body?.code).toBe(UNLINK_LOCKOUT_CODE);
    expect(err?.body?.message).toMatch(/only way to sign in/);
    expect(googleRows(userId)).toHaveLength(1);
  });

  it("selects by the account row id, not the provider name", async () => {
    const { userId, headers } = await userWithGoogle();
    addPasskey(userId);

    await expect(
      auth.api.unlinkAccount({ body: { accountId: "google" }, headers }),
    ).rejects.toMatchObject({ body: { code: "ACCOUNT_NOT_FOUND" } });
    expect(googleRows(userId)).toHaveLength(1);
  });

  it("unlinks when a passkey remains, and resets the email to a placeholder", async () => {
    const { userId, google, headers } = await userWithGoogle();
    addPasskey(userId);

    const res = await auth.api.unlinkAccount({ body: { accountId: google.id }, headers });

    expect(res).toEqual({ status: true });
    expect(googleRows(userId)).toHaveLength(0);
    const row = appDb.select().from(userTable).where(eq(userTable.id, userId)).get();
    expect(isPlaceholderEmail(row?.email)).toBe(true);
  });
});
