# ADR 0001 — Account model: emailless passkey + OAuth, linked on demand

**Status:** Accepted.
**Context:** the app offers passkeys and (env-gated) Google / GitHub OAuth. We
need a signup + account-linking model that (a) can't be pre-hijacked, (b) lets a
user start with *either* method and add the other, and (c) needs no transactional
email (the project [deliberately runs none](./README.md#picks)).

## The threat

Pre-registration account hijacking (Sudhodanan & Argyros, USENIX Security 2022):
an attacker registers an account at a victim's email they don't control, then the
victim's later OAuth sign-in is merged into the attacker's account on an
email-match alone. A federated sign-in proves the *provider user* owns the inbox;
it does **not** prove the account's creator did.

## The question

How are accounts created and identified, and when may two sign-in methods merge?
Options weighed:

- **A — verify email at passkey signup.** Needs a transactional email sender we
  don't run; also needs an unverified-account lifecycle or a squatter still
  blocks the victim.
- **B — keep an email on passkey accounts, link only from a session.** Closes
  takeover but the email is still squat-able, and unverified accounts persist.
- **E — OAuth-first.** Where OAuth is configured, create accounts via the
  provider only (verified-at-birth). Closes both, but forbids a passkey-only
  account in an OAuth deployment, and a pre-existing passkey account couldn't add
  OAuth.
- **D — emailless passkey accounts.** Passkey signup collects only a name and
  claims **no** email; OAuth signup carries a verified one. Both methods are
  offered side by side; a user links the other later.

## Decision

**Option D.** A passkey signup asks for a name and nothing else; both passkey and
OAuth are first-class, peer signup methods shown together.

**Why it's secure by construction:** no signup path lets anyone claim a victim's
email. Passkey signup has no email field; OAuth signup must *prove* the email. So
pre-registration takeover **and** email-squatting are structurally impossible, not
merely guarded — there is no attacker-controllable, email-bearing account for a
victim's identity to be merged into.

### How the pieces fit

- **Synthetic placeholder email.** better-auth's `user.email` is `NOT NULL
  UNIQUE`, so a passkey-only account is minted with `<uuid>@passkey.invalid`
  (`lib/auth/placeholder-email.ts`). `.invalid` (RFC 6761) can never resolve or
  be registered, and still passes better-auth's `z.email()` check (a dotless
  `@passkey` does not). It is never shown in the UI — `isPlaceholderEmail()`
  hides it.
- **Adopt-on-link.** When a placeholder account links an OAuth provider, the
  provider's verified email is adopted onto the row and `emailVerified` set true
  (`adoptProviderEmail` in `lib/auth/index.ts`, read from the Google id_token).
  The account becomes a fully-identified, verified row. `allowDifferentEmails:
  true` is required for this (placeholder ≠ provider email); it only relaxes the
  *explicit, session-scoped* link, not implicit merges.
- **Linking is explicit + session-scoped.** `authClient.linkSocial()` links into
  the caller's *own* account. Implicit (sign-in) linking still merges two
  *verified* OAuth identities that share an email (e.g. Google then GitHub) — both
  sides proven — guarded by no `trustedProviders` and better-auth's
  `requireLocalEmailVerified` (default true). Passkey accounts can't be touched
  by implicit linking at all: their placeholder email matches nothing.

### The two journeys, and reconciliation

1. **passkey → add OAuth:** sign up with a passkey, then Account → Link → the
   account adopts the provider's verified email.
2. **OAuth → add passkey:** sign up with a provider, then add a passkey (the
   post-sign-in prompt or the Account screen).
3. **Two separate accounts** (made each independently): not auto-merged.
   Reconcile by adding a passkey to the OAuth account and abandoning the
   passkey-only one. The cleaner "delete the spare account, then link" needs
   account deletion, which **doesn't exist yet** — tracked separately ([account
   deletion issue](https://github.com/Sitthinut/macrotide/issues/105)). Until it
   ships, abandonment (not deletion) is the path.

## Consequences & the rules that follow

- **The invariant:** *no signup path may create an email-bearing account at an
  address the creator hasn't proven.* Passkey signup stays emailless (synthetic
  placeholder); OAuth/magic-link signups stay verified-at-birth. A future **magic
  link** must materialize its account only *after* the link is clicked.
- **Lockout is enforced in our UI, not by better-auth alone.** The hidden
  `credential` bootstrap row (random password, no sign-in UI) is not a usable
  method, but better-auth's `allowUnlinkingAll` guard counts it — so it would let
  a user unlink their last OAuth provider with no passkeys and lock themselves
  out. The Account screen guards both revoke-passkey and unlink-provider against
  leaving zero *usable* methods (`cannotRevokeLast` / `cannotUnlinkLastOAuth`).
- **A removed passkey is dead.** Deleting a passkey removes the server credential
  row; a later assertion fails the credential lookup (`PASSKEY_NOT_FOUND`). It
  can neither sign in nor create an account. (The private key may linger in the
  user's password manager until they remove it there — cosmetic only.)
- **`requireLocalEmailVerified` is load-bearing despite being deprecated.** Do
  not set it `false`, and do not add `trustedProviders`, without re-reading this
  ADR. Upstream is making the gate unconditional (the safe direction), so relying
  on the default is forward-safe.
- **A refused social sign-in is a friendly dead-end** (`/login?error=…`), never a
  silent merge.
