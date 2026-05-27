import "server-only";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { appDb, appSqlite, marketDb, marketSqlite } from "@/lib/db/client";
import { runWithDbContext } from "@/lib/db/context";
import { socialProvidersConfig, trustedLinkProviders } from "./providers";
import { provisionNewUser } from "./provision";

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
 * `auth.handler` re-export. The auth tables (user/session/account/…) live in
 * app.db, so the drizzle adapter points at the app handle.
 *
 * Auth is required by default. Set `AUTH_DISABLED=1` to opt out (single-user
 * dev only — see [SECURITY.md](../../SECURITY.md)).
 */
export const auth = betterAuth({
  appName: rpName(),
  baseURL: baseURL(),
  database: drizzleAdapter(appDb, { provider: "sqlite" }),
  secret: authSecret(),
  trustedOrigins: origins(),
  // Email/password is enabled ONLY to bootstrap passkey signup.
  // createAccountWithPasskey() in app/(auth)/login/page.tsx calls
  // authClient.signUp.email() to create the user record and obtain a session,
  // then immediately calls authClient.passkey.addPasskey() — passkey remains
  // the only real login method because no password sign-in UI is exposed and
  // the signup flow sets a random unknowable password.
  // This is a bootstrap stopgap: OAuth will eventually replace this
  // mechanism, at which point emailAndPassword can be disabled.
  emailAndPassword: { enabled: true },
  // OAuth. Only providers whose env vars are fully present are
  // registered; with none set this is `{}` and the app runs passkey-only.
  // GOOGLE_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET enable the respective btns.
  socialProviders: socialProvidersConfig(),
  account: {
    // Link an OAuth sign-in to an existing account with the same verified email
    // (e.g. signed up with Google, later signs in with GitHub on the same addr).
    accountLinking: {
      enabled: true,
      trustedProviders: trustedLinkProviders(),
    },
  },
  // New-account provisioning: default tier='free' + one seeded
  // bucket. Runs in an owner DB context stamped with the new user's id so the
  // bucket's user_id is set correctly (the auth route is not withDb-wrapped, so
  // there is no ambient request context here).
  databaseHooks: {
    user: {
      create: {
        after: async (newUser: { id: string }) => {
          await runWithDbContext(
            {
              appDb,
              appSqlite,
              marketDb,
              marketSqlite,
              isDemo: false,
              sessionId: "owner",
              userId: newUser.id,
            },
            () => provisionNewUser(newUser.id),
          );
        },
      },
    },
  },
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
