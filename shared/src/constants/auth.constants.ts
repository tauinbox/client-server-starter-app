export const MAX_FAILED_ATTEMPTS = 5;

export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export const MAX_CONCURRENT_SESSIONS = 5;

export const BCRYPT_SALT_ROUNDS = 12;

export const EMAIL_CHANGE_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export const RESET_TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

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
  OAUTH_DATA: 'oauth_data',
  OAUTH_REAUTH: 'oauth_reauth',
  REAUTH_PROOF: 'reauth_proof'
} as const;

export type TokenPurpose = (typeof TOKEN_PURPOSE)[keyof typeof TOKEN_PURPOSE];

/**
 * How long before an access token expires the client refreshes it.
 *
 * Paired with MIN_JWT_EXPIRATION_SECONDS: a token whose whole lifetime fits
 * inside this window leaves no gap to wait out, so the two must not overlap.
 */
export const TOKEN_REFRESH_WINDOW_SECONDS = 60;

/**
 * Lower bound the server enforces on JWT_EXPIRATION. Kept strictly above the
 * client's refresh window so every issued token has a real interval to schedule
 * against.
 */
export const MIN_JWT_EXPIRATION_SECONDS = 2 * TOKEN_REFRESH_WINDOW_SECONDS;

/**
 * How long a step-up re-authentication proof stays usable. A sensitive change
 * must follow the proof closely, so this is much shorter than a session.
 */
export const REAUTH_PROOF_MAX_AGE_SECONDS = 300;
