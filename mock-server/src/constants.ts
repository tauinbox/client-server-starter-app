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
