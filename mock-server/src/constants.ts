import type { CookieOptions } from 'express';

// Mirrors server/src/modules/auth/casl/constants.ts.
export const CASL_RESERVED_ACTION_NAMES: readonly string[] = ['manage', 'all'];

export const CASL_RESERVED_SUBJECT_NAMES: readonly string[] = ['all'];

export const REFRESH_TOKEN_COOKIE = 'refresh_token';

export const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000
};

export const OAUTH_PROVIDERS = ['google', 'facebook', 'vk'];

// Mirrors OAuthController.OAUTH_DATA_COOKIE / OAUTH_DATA_MAX_AGE_SECONDS.
export const OAUTH_DATA_COOKIE = 'oauth_data';

export const OAUTH_DATA_COOKIE_PATH = '/api/v1/auth/oauth';

export const OAUTH_DATA_MAX_AGE_MS = 60 * 1000;

export const OAUTH_DATA_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: OAUTH_DATA_COOKIE_PATH,
  maxAge: OAUTH_DATA_MAX_AGE_MS
};

/** Mirrors the server: the step-up proof is scoped to the auth routes. */
export const REAUTH_PROOF_COOKIE = 'reauth_proof';
export const REAUTH_PROOF_COOKIE_PATH = '/api/v1/auth';
export const REAUTH_PROOF_MAX_AGE_MS = 300 * 1000;

/**
 * The mock accepts one fixed code and hands out one fixed secret. A real
 * time-based code would make every end-to-end run depend on the clock, which
 * is a flake by construction rather than a test of anything.
 */
export const MOCK_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

export const MOCK_TOTP_CODE = '123456';

/** A 1x1 transparent PNG. The client only needs a renderable image here. */
export const MOCK_TOTP_QR_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export const MOCK_RECOVERY_CODES: readonly string[] = [
  'AAAAAAAA-AAAAAAAA',
  'BBBBBBBB-BBBBBBBB',
  'CCCCCCCC-CCCCCCCC',
  'DDDDDDDD-DDDDDDDD',
  'EEEEEEEE-EEEEEEEE',
  'FFFFFFFF-FFFFFFFF',
  'GGGGGGGG-GGGGGGGG',
  'HHHHHHHH-HHHHHHHH',
  'IIIIIIII-IIIIIIII',
  'JJJJJJJJ-JJJJJJJJ'
];
