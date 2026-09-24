import type { CookieOptions } from 'express';

// Mirrors server/src/modules/auth/casl/constants.ts.
export const CASL_RESERVED_ACTION_NAMES: readonly string[] = ['manage', 'all'];

export const CASL_RESERVED_SUBJECT_NAMES: readonly string[] = ['all'];

/**
 * Mirrors HOST_COOKIE_PATH on the server. Outside `local` the server prefixes
 * every cookie with `__Host-`, which requires this path. The mock only serves
 * `local`, so it keeps the bare names and shares the path.
 */
export const AUTH_COOKIE_PATH = '/';

export const REFRESH_TOKEN_COOKIE = 'refresh_token';

export const REFRESH_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: 'strict',
  path: AUTH_COOKIE_PATH,
  maxAge: 7 * 24 * 60 * 60 * 1000
};

export const OAUTH_PROVIDERS = ['google', 'facebook', 'vk'];

// Mirrors OAuthController.OAUTH_DATA_COOKIE / OAUTH_DATA_MAX_AGE_SECONDS.
export const OAUTH_DATA_COOKIE = 'oauth_data';

export const OAUTH_DATA_MAX_AGE_MS = 60 * 1000;

export const OAUTH_DATA_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: AUTH_COOKIE_PATH,
  maxAge: OAUTH_DATA_MAX_AGE_MS
};

export const REAUTH_PROOF_COOKIE = 'reauth_proof';
export const REAUTH_PROOF_MAX_AGE_MS = 300 * 1000;

/**
 * The server sets these on a provider link or step-up redirect. The mock never
 * sets them, but it clears them where the server does.
 */
export const OAUTH_LINK_COOKIE = 'oauth_link';
export const OAUTH_REAUTH_COOKIE = 'oauth_reauth';

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
  'AAAAAAAA-AAAAAAAA-AAAAAAAA',
  'BBBBBBBB-BBBBBBBB-BBBBBBBB',
  'CCCCCCCC-CCCCCCCC-CCCCCCCC',
  'DDDDDDDD-DDDDDDDD-DDDDDDDD',
  'EEEEEEEE-EEEEEEEE-EEEEEEEE',
  'FFFFFFFF-FFFFFFFF-FFFFFFFF',
  'GGGGGGGG-GGGGGGGG-GGGGGGGG',
  'HHHHHHHH-HHHHHHHH-HHHHHHHH',
  'IIIIIIII-IIIIIIII-IIIIIIII',
  'JJJJJJJJ-JJJJJJJJ-JJJJJJJJ'
];

/**
 * What a regeneration hands back. It is a different set from the enrolment
 * one on purpose: a test can then see that the replacement happened.
 */
export const MOCK_REGENERATED_RECOVERY_CODES: readonly string[] = [
  'KKKKKKKK-KKKKKKKK-KKKKKKKK',
  'LLLLLLLL-LLLLLLLL-LLLLLLLL',
  'MMMMMMMM-MMMMMMMM-MMMMMMMM',
  'NNNNNNNN-NNNNNNNN-NNNNNNNN',
  'PPPPPPPP-PPPPPPPP-PPPPPPPP',
  'QQQQQQQQ-QQQQQQQQ-QQQQQQQQ',
  'RRRRRRRR-RRRRRRRR-RRRRRRRR',
  'SSSSSSSS-SSSSSSSS-SSSSSSSS',
  'TTTTTTTT-TTTTTTTT-TTTTTTTT',
  'UUUUUUUU-UUUUUUUU-UUUUUUUU'
];
