import type { Response } from 'express';
import { REFRESH_COOKIE_OPTIONS, REFRESH_TOKEN_COOKIE } from '../constants';

export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, REFRESH_COOKIE_OPTIONS);
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    path: REFRESH_COOKIE_OPTIONS.path
  });
}
