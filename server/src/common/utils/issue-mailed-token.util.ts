import * as crypto from 'crypto';
import { hashToken } from './hash-token';

export interface IssuedMailedToken {
  rawToken: string;
  hashedToken: string;
  expiresAt: Date;
}

/**
 * A one-time token for a link sent by mail. The raw value goes into the mail
 * only; the database keeps the hash.
 */
export function issueMailedToken(expiryMs: number): IssuedMailedToken {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + expiryMs);
  return { rawToken, hashedToken, expiresAt };
}
