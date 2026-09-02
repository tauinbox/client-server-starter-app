import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const FORMAT_VERSION = 'v1';

/**
 * Symmetric encryption for the few values this application must be able to
 * read back. A password or a mailed token is hashed, because nothing ever
 * needs the original again; a TOTP shared secret is the opposite case, so it
 * is encrypted with a key that lives outside the database.
 *
 * The key is optional. Without it the service reports itself unconfigured and
 * every caller refuses the operation, which is the only safe reading: a
 * deployment that has no key must not fall back to storing a secret in clear
 * text.
 */
@Injectable()
export class SecretEncryptionService {
  private readonly key: Buffer | null;

  constructor(configService: ConfigService) {
    const raw = configService.get<string>('MFA_ENCRYPTION_KEY');
    this.key = raw ? Buffer.from(raw, 'base64') : null;

    if (this.key !== null && this.key.length !== KEY_BYTES) {
      throw new Error(
        `MFA_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${this.key.length}`
      );
    }
  }

  get isConfigured(): boolean {
    return this.key !== null;
  }

  /**
   * Returns `v1.<iv>.<tag>.<ciphertext>`, each part base64url. The version
   * prefix is what makes a later key rotation or algorithm change readable:
   * stored values say which scheme produced them.
   */
  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final()
    ]);

    return [
      FORMAT_VERSION,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url')
    ].join('.');
  }

  decrypt(payload: string): string {
    const key = this.requireKey();
    const parts = payload.split('.');

    if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
      throw new Error('Encrypted payload is malformed');
    }

    const iv = Buffer.from(parts[1], 'base64url');
    const authTag = Buffer.from(parts[2], 'base64url');

    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
      throw new Error('Encrypted payload is malformed');
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64url')),
      decipher.final()
    ]).toString('utf8');
  }

  private requireKey(): Buffer {
    if (this.key === null) {
      throw new Error('MFA_ENCRYPTION_KEY is not configured');
    }
    return this.key;
  }
}

/**
 * Constant-time comparison of two hex digests. Exported here because every
 * caller of this file compares one secret-derived value against another.
 */
export function digestsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
