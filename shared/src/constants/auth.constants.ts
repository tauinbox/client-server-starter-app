export const MAX_FAILED_ATTEMPTS = 5;

export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export const MAX_CONCURRENT_SESSIONS = 5;

export const BCRYPT_SALT_ROUNDS = 12;

export const EMAIL_CHANGE_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export const JWT_ISSUER = 'nexus-api';

export const JWT_AUDIENCE = 'nexus-client';

/**
 * Marks what a signed token may be used for. Every token this service issues is
 * signed with the same key, so without an explicit purpose a token minted for
 * one flow is indistinguishable from an access token and is accepted by the
 * bearer strategy.
 */
export const TOKEN_PURPOSE = {
  ACCESS: 'access',
  OAUTH_LINK: 'oauth_link',
  OAUTH_DATA: 'oauth_data'
} as const;

export type TokenPurpose = (typeof TOKEN_PURPOSE)[keyof typeof TOKEN_PURPOSE];
