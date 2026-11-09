import { describe, expect, it } from "vitest";
import { oauthErrorMessage } from "./oauth-errors";

const STEER = /sign in with your original method, then link this provider/;
const GENERIC = "Sign-in didn't complete. Please try again.";

describe("oauthErrorMessage", () => {
  it.each([
    "account_not_linked",
    "unable_to_link_account",
    "email_does_not_match",
  ])("steers %s to the original sign-in method", (code) => {
    expect(oauthErrorMessage(code)).toMatch(STEER);
  });

  it("treats the pre-1.7 `email_doesn't_match` spelling as unknown", () => {
    expect(oauthErrorMessage("email_doesn't_match")).toBe(GENERIC);
  });

  it("falls back to generic copy for other codes", () => {
    expect(oauthErrorMessage("state_mismatch")).toBe(GENERIC);
    expect(oauthErrorMessage("internal_server_error")).toBe(GENERIC);
  });

  it("shows nothing without a code", () => {
    expect(oauthErrorMessage(null)).toBeNull();
    expect(oauthErrorMessage("")).toBeNull();
  });
});
