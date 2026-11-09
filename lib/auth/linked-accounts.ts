// Shape returned by better-auth's /list-accounts endpoint. `id` is the local
// account row's primary key; `accountId` is the provider's own user id.
export interface LinkedAccount {
  id: string;
  providerId: string;
  accountId: string;
}

/**
 * The value to pass to `unlinkAccount({ accountId })` for a provider: the local
 * account row id from /list-accounts, not the provider name and not the
 * provider's user id. Null when the provider isn't linked.
 */
export function unlinkTargetId(
  accounts: readonly LinkedAccount[] | null | undefined,
  providerId: string,
): string | null {
  return accounts?.find((a) => a.providerId === providerId)?.id ?? null;
}
