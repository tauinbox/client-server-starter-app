import type { Response } from 'express';
import {
  LEGACY_REFRESH_TOKEN_PATH,
  REFRESH_COOKIE_OPTIONS,
  REFRESH_TOKEN_COOKIE
} from '../constants';

// Mirrors server/src/modules/auth/utils/refresh-token-cookie.ts: every write
// and every clear also drops the refresh cookie of the old path.
function clearLegacyRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: LEGACY_REFRESH_TOKEN_PATH });
}

export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, REFRESH_COOKIE_OPTIONS);
  clearLegacyRefreshTokenCookie(res);
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    path: REFRESH_COOKIE_OPTIONS.path
  });
  clearLegacyRefreshTokenCookie(res);
}
