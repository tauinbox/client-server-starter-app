import * as crypto from 'crypto';
import { hashToken } from './hash-token';

export const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

export interface IssuedVerificationToken {
  rawToken: string;
  hashedToken: string;
  expiresAt: Date;
}

export function issueEmailVerificationToken(): IssuedVerificationToken {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS);
  return { rawToken, hashedToken, expiresAt };
}
