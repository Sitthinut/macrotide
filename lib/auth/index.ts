import "server-only";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { ownerDb } from "@/lib/db/client";

function rpName(): string {
  return process.env.AUTH_RP_NAME ?? "Macrotide";
}

function rpId(): string | undefined {
  return process.env.AUTH_RP_ID;
}

function origins(): string[] {
  // Always allow the dev origin; production should set PUBLIC_APP_URL.
  const raw = process.env.PUBLIC_APP_URL;
  const list = ["http://localhost:3000"];
  if (raw) list.push(raw.replace(/\/$/, ""));
  return list;
}

/**
 * better-auth singleton. Routes are exposed at `/api/auth/[...all]` via the
 * `auth.handler` re-export. Sessions live in the same SQLite as app data.
 *
 * Multi-user mode is opt-in: set `AUTH_REQUIRED=1` to gate the app behind a
 * passkey login. When unset (single-user mode), the app behaves like before
 * and any session lookup returns `null`.
 */
export const auth = betterAuth({
  appName: rpName(),
  database: drizzleAdapter(ownerDb, { provider: "sqlite" }),
  secret: process.env.AUTH_SECRET ?? "macrotide-dev-secret-change-me",
  trustedOrigins: origins(),
  // Email/password is disabled by default — passkey is the primary path.
  // Email magic-link is a planned addition once we wire a transactional
  // sender (Resend / Postmark / SES); leave off until then so users don't
  // see a button that silently fails.
  emailAndPassword: { enabled: false },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once per day
  },
  plugins: [
    passkey({
      rpName: rpName(),
      ...(rpId() ? { rpID: rpId() } : {}),
      origin: origins()[origins().length - 1],
    }),
  ],
});

export type Auth = typeof auth;
