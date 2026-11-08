import { SIGNED_TOKEN_REFUSALS } from '../constants/auth.constants';

/**
 * True when a token was issued before the account's last revocation, so it
 * must be refused.
 *
 * `iat` has one-second resolution and the revocation timestamp has
 * milliseconds, so the revocation is floored to its second. An unfloored bound
 * refuses every token minted after a revocation inside the same second - a
 * sign-in or a step-up right after a sign-out would fail. The price is that a
 * token minted earlier in that second is accepted; every revocation also ends
 * the sessions, which refuses an access token on its own.
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
 * True when a session started before the account's last revocation, so it
 * must not be refreshed. The revocation deletes the refresh rows, but a row
 * that a sign-in inserts and commits around that delete survives it. Both
 * values have milliseconds and come from the clock of the application, so no
 * floor applies.
 *
 * `startedAt` is a `Date` on the server and epoch milliseconds in the mock.
 */
export function sessionStartedBeforeRevocation(
  startedAt: Date | number,
  revokedAt: Date | string | null
): boolean {
  if (revokedAt === null) {
    return false;
  }

  return new Date(startedAt).getTime() < new Date(revokedAt).getTime();
}

/** Why a token that the server signed for an account no longer signs it in. */
export type SignedTokenRefusal = (typeof SIGNED_TOKEN_REFUSALS)[number];

/**
 * The account that a signed sign-in token names, or the reason it can no
 * longer sign in. The caller gives the same answer for every refusal and
 * writes the reason only to its audit row.
 */
export function signedTokenAccount<
  U extends { isActive: boolean; tokenRevokedAt: Date | string | null }
>(
  user: U | null | undefined,
  iat: number
): { user: U } | { refusal: SignedTokenRefusal } {
  if (!user) {
    return { refusal: 'account_not_found' };
  }

  if (!user.isActive) {
    return { refusal: 'account_deactivated' };
  }

  if (issuedBeforeRevocation(iat, user.tokenRevokedAt)) {
    return { refusal: 'session_revoked' };
  }

  return { user };
}
