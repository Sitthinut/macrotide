import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enabledProviders, socialProvidersConfig } from "./providers";

const OAUTH_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
] as const;

describe("OAuth provider env-gating", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of OAUTH_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of OAUTH_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("none enabled when no env vars are set", () => {
    expect(enabledProviders()).toEqual({ google: false, github: false });
    expect(socialProvidersConfig()).toEqual({});
  });

  it("a provider needs BOTH id and secret to count as enabled", () => {
    process.env.GOOGLE_CLIENT_ID = "id-only";
    expect(enabledProviders().google).toBe(false);
    expect(socialProvidersConfig()).toEqual({});

    process.env.GOOGLE_CLIENT_SECRET = "secret";
    expect(enabledProviders().google).toBe(true);
    expect(socialProvidersConfig().google).toEqual({
      clientId: "id-only",
      clientSecret: "secret",
    });
  });

  it("builds config for each configured provider independently", () => {
    process.env.GITHUB_CLIENT_ID = "gh-id";
    process.env.GITHUB_CLIENT_SECRET = "gh-secret";
    expect(enabledProviders()).toEqual({ google: false, github: true });
    expect(Object.keys(socialProvidersConfig())).toEqual(["github"]);

    process.env.GOOGLE_CLIENT_ID = "g-id";
    process.env.GOOGLE_CLIENT_SECRET = "g-secret";
    expect(Object.keys(socialProvidersConfig()).sort()).toEqual(["github", "google"]);
  });
});
