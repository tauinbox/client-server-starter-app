import type { Request, Response } from 'express';
import { REFRESH_COOKIE_OPTIONS, REFRESH_TOKEN_COOKIE } from '../constants';
import { endSessionOfToken } from '../state';

export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, REFRESH_COOKIE_OPTIONS);
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    path: REFRESH_COOKIE_OPTIONS.path
  });
}

/**
 * Ends the session whose refresh cookie a sign-in request carried, whatever
 * account owns it. Mirrors `AuthService.endPresentedSession`.
 */
export function endPresentedSession(req: Request): void {
  const cookieToken = (req.cookies as Record<string, string> | undefined)?.[
    REFRESH_TOKEN_COOKIE
  ];
  if (cookieToken) endSessionOfToken(cookieToken);
}
