// Size limits for one broker sync. A sync creates a portfolio and a connection
// row per new broker account and stores the login label and account order per
// user, so every client-supplied size that reaches storage is bounded here.
// A real export lists one account per investment plan, which is a handful for a
// typical investor; the limits sit far above that so no genuine export trips
// them. Pure: the per-user connection count is checked against the DB by the
// ingest route.

import { MAX_PORTFOLIO_NAME_LENGTH } from "./bucket-input";

/** Distinct broker accounts one export may list or route orders to. */
export const MAX_SYNC_ACCOUNTS = 50;
/** Broker connections one user may hold across all brokers. A sync that would
 *  add a connection past this is refused; syncing existing accounts still works. */
export const MAX_USER_BROKER_CONNECTIONS = 100;
/** Broker account code length (stored on the connection and the portfolio). */
export const MAX_ACCOUNT_CODE_LENGTH = 64;
/** Account (plan) name length; it becomes the new portfolio's name. */
export const MAX_ACCOUNT_NAME_LENGTH = MAX_PORTFOLIO_NAME_LENGTH;
/** Broker login label length (a name or an email address; emails cap at 254). */
export const MAX_LOGIN_LABEL_LENGTH = 254;
/** Fund ticker length, matching the manual transaction form's limit. */
export const MAX_TICKER_LENGTH = 64;
/** Dedup key length (`source:account:ref`, or a content fallback). */
export const MAX_EXTERNAL_ID_LENGTH = 512;
/** Importable order rows in one sync (years of history across many plans is a
 *  few thousand). */
export const MAX_SYNC_ROWS = 50_000;
/** Request body size. Exports carry the broker's raw order objects, so a long
 *  history runs to a few megabytes. */
export const MAX_SYNC_BODY_BYTES = 25 * 1024 * 1024;

export interface SyncLimitError {
  error: string;
  message: string;
}

export interface SyncShape {
  /** Every account code the export names, in export order (its account list). */
  listedAccounts: string[];
  /** Account code → plan name, from the export's account list. */
  names: Map<string, string>;
  /** Account codes the importable rows route to (may include unlisted ones). */
  rowAccounts: Iterable<string>;
  accountLabel: string;
  rows: { ticker: string; externalId?: string | null }[];
}

/** The first limit the sync breaks, or null when it fits. */
export function checkSyncLimits(s: SyncShape): SyncLimitError | null {
  if (s.accountLabel.length > MAX_LOGIN_LABEL_LENGTH) {
    return {
      error: "label_too_long",
      message: `The broker login label is longer than ${MAX_LOGIN_LABEL_LENGTH} characters.`,
    };
  }
  if (s.rows.length > MAX_SYNC_ROWS) {
    return {
      error: "too_many_rows",
      message: `A sync can import at most ${MAX_SYNC_ROWS} orders.`,
    };
  }
  const accounts = new Set<string>([...s.listedAccounts, ...s.rowAccounts]);
  if (accounts.size > MAX_SYNC_ACCOUNTS) {
    return {
      error: "too_many_accounts",
      message: `A sync can include at most ${MAX_SYNC_ACCOUNTS} broker accounts.`,
    };
  }
  for (const code of accounts) {
    if (code.length > MAX_ACCOUNT_CODE_LENGTH) {
      return {
        error: "field_too_long",
        message: `A broker account code is longer than ${MAX_ACCOUNT_CODE_LENGTH} characters.`,
      };
    }
  }
  for (const name of s.names.values()) {
    if (name.length > MAX_ACCOUNT_NAME_LENGTH) {
      return {
        error: "field_too_long",
        message: `A broker account name is longer than ${MAX_ACCOUNT_NAME_LENGTH} characters.`,
      };
    }
  }
  for (const r of s.rows) {
    if (r.ticker.length > MAX_TICKER_LENGTH) {
      return {
        error: "field_too_long",
        message: `A fund code is longer than ${MAX_TICKER_LENGTH} characters.`,
      };
    }
    if ((r.externalId?.length ?? 0) > MAX_EXTERNAL_ID_LENGTH) {
      return {
        error: "field_too_long",
        message: "An order reference is too long.",
      };
    }
  }
  return null;
}
