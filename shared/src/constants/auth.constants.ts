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
  REAUTH_PROOF: 'reauth_proof',
  MFA_PENDING: 'mfa_pending'
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

/**
 * How long the intermediate token minted by a correct password stays usable.
 * It only lets its holder present a second factor, so it is short: long enough
 * for a person to read a code from an authenticator app, and no longer.
 */
export const MFA_PENDING_TOKEN_EXPIRY_SECONDS = 300;

/**
 * Issuer shown by the authenticator app beside the account. It is part of the
 * otpauth URI, so the server and the mock must agree on it.
 */
export const TOTP_ISSUER = 'Nexus';

/** Time step of a TOTP code, in seconds. RFC 6238 default. */
export const TOTP_PERIOD_SECONDS = 30;

/** Number of digits in a TOTP code. RFC 6238 default. */
export const TOTP_DIGITS = 6;

/**
 * Clock skew the server accepts, in seconds. One period each way: a code from
 * the previous step is accepted, a code two steps old is not. Chosen
 * deliberately rather than left at the library default of zero, which refuses
 * a code the user read one second before the step rolled over.
 */
export const TOTP_EPOCH_TOLERANCE_SECONDS = 30;

/** How many single-use recovery codes an enrolment produces. */
export const MFA_RECOVERY_CODE_COUNT = 10;

/**
 * Bytes of entropy behind one recovery code. Ten bytes render as sixteen
 * base32 characters, which the server presents in two groups of eight.
 */
export const MFA_RECOVERY_CODE_BYTES = 10;
