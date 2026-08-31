import { getState } from '../state';
import type { MockUser } from '../types';

/**
 * Mirrors the checks the server runs on a `reauth_proof` JWT: the proof names
 * this account, it has not expired, and it was not minted before the last
 * session revocation. The mock has no provider round trip to produce one, so
 * `POST /__control/reauth-proof` seeds it instead.
 */
export function isValidReauthProof(
  proof: string | undefined,
  user: MockUser
): boolean {
  if (!proof) {
    return false;
  }

  const record = getState().reauthProofs.get(proof);
  if (!record || record.userId !== user.id || record.expiresAt < Date.now()) {
    return false;
  }

  if (
    user.tokenRevokedAt &&
    record.issuedAt < new Date(user.tokenRevokedAt).getTime() / 1000
  ) {
    return false;
  }

  return true;
}
