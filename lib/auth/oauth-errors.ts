/**
 * Map a better-auth OAuth `?error=<code>` redirect to friendly copy. The codes
 * come from the OAuth callback when a social sign-in can't complete, e.g.
 * `account_not_linked` when the provider's email is unverified, or when the
 * address already belongs to an account that can't be auto-merged. We never
 * silently merge into a mismatched account (the pre-registration takeover
 * guard), so on these we steer the user to their other sign-in method rather
 * than guessing which one. Method-agnostic copy: under the passkey/OAuth model
 * the existing account could use either method.
 */
export function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "account_not_linked":
    case "unable_to_link_account":
    case "email_does_not_match":
      return "We couldn't sign you in with that provider. If you already have an account, sign in with your original method, then link this provider from Account settings.";
    default:
      return "Sign-in didn't complete. Please try again.";
  }
}

/**
 * Where a failed provider link from Account returns. better-auth appends
 * `&error=<code>`; the app reads it on load and reopens Account with the reason,
 * instead of leaving the user on better-auth's bare error page.
 */
export const LINK_ERROR_CALLBACK_URL = "/?link=failed";

/** The error code a failed link came back with, or null when this load isn't one. */
export function linkErrorCode(search: string): string | null {
  const params = new URLSearchParams(search);
  if (params.get("link") !== "failed") return null;
  return params.get("error") || "unknown";
}

/** Friendly copy for a failed link, shown on the Account screen. */
export function linkErrorMessage(code: string): string {
  switch (code) {
    case "account_already_linked_to_different_user":
      return "That account is already linked to another Macrotide account, so it can't be linked here too.";
    case "access_denied":
      return "Linking was cancelled. You can try again any time.";
    case "unable_to_link_account":
    case "email_does_not_match":
      return "We couldn't link that account. Please try again.";
    default:
      return "Linking didn't complete. Please try again.";
  }
}
