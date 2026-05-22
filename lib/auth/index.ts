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

function baseURL(): string {
  return process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
}

function origins(): string[] {
  // Always allow the dev origin; production should set PUBLIC_APP_URL.
  const list = ["http://localhost:3000"];
  const prod = baseURL();
  if (prod !== "http://localhost:3000") list.push(prod);
  return list;
}

// Dev fallback so `npm run dev` works without setup. Long enough to clear
// better-auth's 32-char length warning, but still dictionary words so the
// entropy warning fires as a reminder. In production, AUTH_SECRET is required.
const DEV_FALLBACK_SECRET = "macrotide-dev-fallback-not-for-production-32chars-min";

function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET must be set in production. Generate with `openssl rand -base64 32`.",
    );
  }
  return DEV_FALLBACK_SECRET;
}

/**
 * better-auth singleton. Routes are exposed at `/api/auth/[...all]` via the
 * `auth.handler` re-export. Sessions live in the same SQLite as app data.
 *
 * Auth is required by default. Set `AUTH_DISABLED=1` to opt out (single-user
 * dev only — see [SECURITY.md](../../SECURITY.md)).
 */
export const auth = betterAuth({
  appName: rpName(),
  baseURL: baseURL(),
  database: drizzleAdapter(ownerDb, { provider: "sqlite" }),
  secret: authSecret(),
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
