import "server-only";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { appDb, appSqlite, marketDb, marketSqlite } from "@/lib/db/client";
import { runWithDbContext } from "@/lib/db/context";
import { user as userTable } from "@/lib/db/schema";
import { idTokenEmail } from "./id-token";
import { isPlaceholderEmail } from "./placeholder-email";
import { socialProvidersConfig } from "./providers";
import { provisionNewUser } from "./provision";

/**
 * Adopt a freshly-linked provider's verified email onto a passkey-first account
 * that still carries a placeholder address (see {@link isPlaceholderEmail}).
 * Runs from the `account.create` hook on every link.
 *
 * Only fires for social providers and only when the local email is still a
 * placeholder, so it's a no-op for: the `credential` bootstrap row, and
 * OAuth-first signups (whose user row already has the real email). The email is
 * unique, so a collision (another account already owns it) is swallowed — the
 * link still succeeds, the account just keeps its placeholder.
 */
function adoptProviderEmail(account: {
  userId: string;
  providerId: string;
  idToken?: string | null;
}): void {
  if (account.providerId !== "google" && account.providerId !== "github") return;
  const current = appDb
    .select({ email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, account.userId))
    .get()?.email;
  if (!isPlaceholderEmail(current)) return;
  const { email, verified } = idTokenEmail(account.idToken);
  if (!email || !verified || isPlaceholderEmail(email)) return;
  try {
    appDb
      .update(userTable)
      .set({ email: email.toLowerCase(), emailVerified: true, updatedAt: new Date() })
      .where(eq(userTable.id, account.userId))
      .run();
  } catch (e) {
    // Unique-collision (the email already belongs to another account) or any
    // write error: leave the placeholder. The provider is still linked and
    // usable for sign-in; only the display email is unchanged.
    console.warn("[auth] could not adopt provider email onto placeholder account", e);
  }
}

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
    // Account linking, hardened against pre-registration takeover (#98).
    //
    // Implicit linking stays ON: a sign-in that matches an existing account by
    // email is auto-merged — but ONLY when BOTH sides are proven. So two
    // *verified* methods on the same address (Google then GitHub, or a future
    // magic link) unify into one account with no manual step.
    //
    // Two guards make "both sides proven" hold, and they are the whole security
    // story here:
    //   1. No `trustedProviders`. That list would bypass the *incoming*
    //      provider's `email_verified` requirement. We don't need it (Google and
    //      GitHub both assert it) and omitting it means a future non-verifying
    //      IdP can never auto-link on an unproven email claim.
    //   2. better-auth's `requireLocalEmailVerified` guards the *local* side: a
    //      social sign-in is refused if it would link onto an existing
    //      UNVERIFIED account — exactly the pre-registration takeover vector
    //      (attacker pre-registers victim@ unverified, victim's real Google
    //      later tries to merge in). It defaults to `true` and is slated to
    //      become unconditional, so we rely on the default rather than pin the
    //      deprecated option. DO NOT set it to `false`, and DO NOT add
    //      `trustedProviders`, without re-reading docs/explanation/decisions/0002.
    //
    // This is safe because our signup model keeps accounts verified-at-birth:
    // where OAuth is configured, new accounts are created via OAuth (verified);
    // the email/passkey bootstrap (unverified) only runs as the passkey-only,
    // no-OAuth fallback — where there is no provider to link, so nothing to
    // hijack. The in-app path for a logged-in user to attach another provider is
    // `authClient.linkSocial()`, which links into *their own* session account.
    //
    // `allowDifferentEmails` is required because a passkey-first account's email
    // is a synthetic placeholder (see ./placeholder-email): linking a real
    // provider necessarily means the emails differ. It only relaxes the
    // *explicit* session-scoped link (a user attaching their own provider), so
    // it doesn't widen the implicit-merge surface. On link, `adoptProviderEmail`
    // replaces the placeholder with the provider's verified email.
    accountLinking: {
      enabled: true,
      allowDifferentEmails: true,
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
    // On linking an OAuth provider to a passkey-first (placeholder-email)
    // account, adopt the provider's verified email so the account becomes a
    // fully-identified, verified row. No-op for the bootstrap row and for
    // OAuth-first signups. See adoptProviderEmail above.
    account: {
      create: {
        after: async (newAccount: {
          userId: string;
          providerId: string;
          idToken?: string | null;
        }) => {
          adoptProviderEmail(newAccount);
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
