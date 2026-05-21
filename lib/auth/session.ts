import "server-only";
import { headers } from "next/headers";
import { auth } from ".";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

/**
 * Resolve the currently-logged-in user from request headers. Returns null when
 * no session cookie is present, when the session has expired, or when auth is
 * disabled (single-user mode).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const hdrs = await headers();
    const result = await auth.api.getSession({ headers: hdrs });
    if (!result?.user) return null;
    return {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
    };
  } catch {
    return null;
  }
}

/**
 * True when `AUTH_REQUIRED=1` — the app refuses to render the dashboard until
 * a passkey login has happened. Demo cookie bypasses this.
 */
export function isAuthRequired(): boolean {
  return process.env.AUTH_REQUIRED === "1";
}
