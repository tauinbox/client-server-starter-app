import type { Request, Response } from 'express';
import {
  clearHostCookie,
  readHostCookie,
  setHostCookie
} from '../../../common/utils/host-cookie';

export const REFRESH_TOKEN_COOKIE = 'refresh_token';

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
}

export function clearRefreshTokenCookie(res: Response, secure: boolean): void {
  clearHostCookie(res, REFRESH_TOKEN_COOKIE, secure);
}

export function readRefreshTokenCookie(
  req: Pick<Request, 'cookies'>,
  secure: boolean
): string | undefined {
  return readHostCookie(req, REFRESH_TOKEN_COOKIE, secure);
}
