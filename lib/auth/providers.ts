import "server-only";

/**
 * OAuth provider availability.
 *
 * A provider is "enabled" only when BOTH its client id and secret env vars are
 * present. This keeps the app bootable with zero OAuth config (dev / passkey-
 * only deploys) — `socialProvidersConfig()` returns `{}` and the better-auth
 * config registers no social providers, while the `/login` page hides the
 * corresponding buttons (it reads {@link enabledProviders} via `/api/auth-config`).
 *
 * Env vars (operator-supplied; never committed):
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 *   GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
 */
export interface EnabledProviders {
  google: boolean;
  github: boolean;
}

export function enabledProviders(): EnabledProviders {
  return {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  };
}

interface SocialProvider {
  clientId: string;
  clientSecret: string;
}

/**
 * Build the better-auth `socialProviders` object, including only the providers
 * whose env vars are fully present. Returns `{}` when none are configured.
 */
export function socialProvidersConfig(): Record<string, SocialProvider> {
  const flags = enabledProviders();
  const cfg: Record<string, SocialProvider> = {};
  if (flags.google) {
    cfg.google = {
      // biome-ignore lint/style/noNonNullAssertion: flags.google guarantees presence
      clientId: process.env.GOOGLE_CLIENT_ID!,
      // biome-ignore lint/style/noNonNullAssertion: flags.google guarantees presence
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    };
  }
  if (flags.github) {
    cfg.github = {
      // biome-ignore lint/style/noNonNullAssertion: flags.github guarantees presence
      clientId: process.env.GITHUB_CLIENT_ID!,
      // biome-ignore lint/style/noNonNullAssertion: flags.github guarantees presence
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    };
  }
  return cfg;
}
