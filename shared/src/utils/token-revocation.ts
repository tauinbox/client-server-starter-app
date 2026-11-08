import { SIGNED_TOKEN_REFUSALS } from '../constants/auth.constants';

/**
 * True when an access token was issued before the account's last revocation,
 * so it must be refused.
 *
 * `iat` has one-second resolution and the revocation timestamp has
 * milliseconds, so the revocation is floored to its second. An unfloored bound
 * refuses every token minted after a revocation inside the same second - a
 * sign-in right after a sign-out would fail. The price is that a token minted
 * earlier in that second is accepted. That is safe only for a token that a
 * live session also guards: every revocation ends the sessions, and the access
 * token is refused with its session. A token that no session guards uses
 * `stampedBeforeRevocation` with a millisecond issue time instead.
 *
 * `revokedAt` is a `Date` on the server and an ISO string in the mock.
 */
export function issuedBeforeRevocation(
  iat: number,
  revokedAt: Date | string | null
): boolean {
  if (revokedAt === null) {
    return false;
  }

  return iat < Math.floor(new Date(revokedAt).getTime() / 1000);
}

/**
 * True when a session started, or a token that no session guards was issued,
 * before the account's last revocation, so it must be refused. Both values
 * have milliseconds and come from the clock of the application, so no floor
 * applies, and a token issued earlier in the second of the revocation is
 * refused.
 *
 * A session needs this check because the revocation deletes the refresh rows,
 * but a row that a sign-in inserts and commits around that delete survives
 * it. A token that no session guards (the `oauth_data` cookie, a pending
 * sign-in, an intent, a step-up proof) has nothing else that ends it.
 *
 * `stampedAt` is a `Date` or epoch milliseconds. `revokedAt` is a `Date` on
 * the server and an ISO string in the mock.
 */
export function stampedBeforeRevocation(
  stampedAt: Date | number,
  revokedAt: Date | string | null
): boolean {
  if (revokedAt === null) {
    return false;
  }

  return new Date(stampedAt).getTime() < new Date(revokedAt).getTime();
}

/** Why a token that the server signed for an account no longer signs it in. */
export type SignedTokenRefusal = (typeof SIGNED_TOKEN_REFUSALS)[number];

/**
 * The account that a value the server trusts names (a linked identity, a
 * signed token), or the reason it can no longer sign in.
 */
export function accountRefusal<U extends { isActive: boolean }>(
  user: U | null | undefined
): { user: U } | { refusal: Exclude<SignedTokenRefusal, 'session_revoked'> } {
  if (!user) {
    return { refusal: 'account_not_found' };
  }

  if (!user.isActive) {
    return { refusal: 'account_deactivated' };
  }

  return { user };
}

/**
 * The account that a signed token with no session names, or the reason it can
 * no longer sign in. `issuedAtMs` is the issue time of the token in epoch
 * milliseconds. The caller gives the same answer for every refusal and writes
 * the reason only to its audit row.
 */
export function signedTokenAccount<
  U extends { isActive: boolean; tokenRevokedAt: Date | string | null }
>(
  user: U | null | undefined,
  issuedAtMs: number
): { user: U } | { refusal: SignedTokenRefusal } {
  const verdict = accountRefusal(user);

  if ('refusal' in verdict) {
    return verdict;
  }

  if (stampedBeforeRevocation(issuedAtMs, verdict.user.tokenRevokedAt)) {
    return { refusal: 'session_revoked' };
  }

  return verdict;
}
