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
