import * as bcrypt from 'bcrypt';
import { createHmac } from 'crypto';
import { BCRYPT_SALT_ROUNDS } from '@app/shared/constants';

/**
 * The storage format of `users.password`.
 *
 * - `LEGACY`: bcrypt over the raw password. bcrypt reads at most 72 bytes, so
 *   the tail of a longer password is not part of the credential.
 * - `PREHASHED`: bcrypt over `prehashPassword(raw)`, a 44-character value, so
 *   every character of the password counts.
 */
export const PasswordHashVersion = {
  LEGACY: 1,
  PREHASHED: 2
} as const;

export type PasswordHashVersion =
  (typeof PasswordHashVersion)[keyof typeof PasswordHashVersion];

/**
 * A constant, not a secret. It only makes the pre-hash differ from a plain
 * SHA-256, so a stolen bcrypt hash cannot be tested against a corpus of
 * unsalted SHA-256 hashes ("password shucking"). A secret key would add
 * nothing here and would lock out every account the day it is lost.
 */
const PREHASH_KEY = 'nexus-password-prehash-v1';

/**
 * Base64 of an HMAC-SHA-256: 44 ASCII characters, well under the 72 bytes
 * bcrypt reads, and never a NUL byte, at which bcrypt would stop reading.
 */
export function prehashPassword(password: string): string {
  return createHmac('sha256', PREHASH_KEY).update(password).digest('base64');
}

export async function hashPassword(
  password: string
): Promise<{ hash: string; version: PasswordHashVersion }> {
  return {
    hash: await bcrypt.hash(prehashPassword(password), BCRYPT_SALT_ROUNDS),
    version: PasswordHashVersion.PREHASHED
  };
}

/**
 * `upgrade` is true when a legacy hash matched. The caller then holds the
 * plaintext, which is the only moment the row can move to the current format.
 */
export async function verifyPassword(
  password: string,
  hash: string,
  version: number
): Promise<{ valid: boolean; upgrade: boolean }> {
  const legacy = version === PasswordHashVersion.LEGACY;
  const valid = await bcrypt.compare(
    legacy ? password : prehashPassword(password),
    hash
  );
  return { valid, upgrade: valid && legacy };
}
