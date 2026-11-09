import { describe, expect, it } from "vitest";
import {
  LINK_ERROR_CALLBACK_URL,
  linkErrorCode,
  linkErrorMessage,
  oauthErrorMessage,
} from "./oauth-errors";

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

describe("linkErrorCode", () => {
  it("reads the code better-auth appends to the link error callback", () => {
    const returned = new URL(
      `${LINK_ERROR_CALLBACK_URL}&error=account_already_linked_to_different_user`,
      "http://localhost",
    );
    expect(linkErrorCode(returned.search)).toBe("account_already_linked_to_different_user");
  });

  it("keeps a code with an error_description alongside it", () => {
    expect(linkErrorCode("?link=failed&error=access_denied&error_description=User+cancelled")).toBe(
      "access_denied",
    );
  });

  it("falls back to `unknown` when the code is missing", () => {
    expect(linkErrorCode("?link=failed")).toBe("unknown");
  });

  it("ignores loads that aren't a failed link", () => {
    expect(linkErrorCode("")).toBeNull();
    expect(linkErrorCode("?error=access_denied")).toBeNull();
    expect(linkErrorCode("?link=done&error=access_denied")).toBeNull();
  });
});

describe("linkErrorMessage", () => {
  it("explains a provider account that belongs to another user", () => {
    expect(linkErrorMessage("account_already_linked_to_different_user")).toMatch(
      /already linked to another Macrotide account/,
    );
  });

  it("treats a cancelled consent screen as a cancel, not a failure", () => {
    expect(linkErrorMessage("access_denied")).toMatch(/^Linking was cancelled/);
  });

  it.each(["unable_to_link_account", "email_does_not_match"])("asks to retry on %s", (code) => {
    expect(linkErrorMessage(code)).toBe("We couldn't link that account. Please try again.");
  });

  it("falls back to generic copy for other codes", () => {
    expect(linkErrorMessage("state_mismatch")).toBe("Linking didn't complete. Please try again.");
    expect(linkErrorMessage("unknown")).toBe("Linking didn't complete. Please try again.");
  });
});
