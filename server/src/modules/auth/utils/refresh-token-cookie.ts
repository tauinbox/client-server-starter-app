import type { Request, Response } from 'express';
import {
  clearHostCookie,
  readHostCookie,
  setHostCookie
} from '../../../common/utils/host-cookie';

export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * Before the `__Host-` prefix the refresh cookie was bare and lived on this
 * path. A browser that signed in before that change still holds it for up to
 * JWT_REFRESH_EXPIRATION, so the refresh and logout routes accept it once and
 * every write clears it. Remove this path, `readRefreshTokenCookie`'s fallback
 * and `clearLegacyRefreshTokenCookie` once that window has passed.
 */
const LEGACY_REFRESH_TOKEN_PATH = '/api/v1/auth';

function clearLegacyRefreshTokenCookie(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    secure,
    path: LEGACY_REFRESH_TOKEN_PATH
  });
}

export function setRefreshTokenCookie(
  res: Response,
  token: string,
  maxAge: number,
  secure: boolean
): void {
  setHostCookie(res, REFRESH_TOKEN_COOKIE, token, secure, {
    httpOnly: true,
    sameSite: 'strict',
    maxAge
  });
  clearLegacyRefreshTokenCookie(res, secure);
}

export function clearRefreshTokenCookie(res: Response, secure: boolean): void {
  clearHostCookie(res, REFRESH_TOKEN_COOKIE, secure);
  clearLegacyRefreshTokenCookie(res, secure);
}

export function readRefreshTokenCookie(
  req: Pick<Request, 'cookies'>,
  secure: boolean
): string | undefined {
  return (
    readHostCookie(req, REFRESH_TOKEN_COOKIE, secure) ??
    readHostCookie(req, REFRESH_TOKEN_COOKIE, false)
  );
}
