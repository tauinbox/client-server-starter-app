import type { Request, Response } from 'express';
import { ANON_ID_PATTERN } from '@app/shared/constants';
import {
  readHostCookie,
  setHostCookie
} from '../../../common/utils/host-cookie';

export const ANON_ID_COOKIE = 'nxs_anon_id';
const ANON_ID_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * The visitor's rollout id, or null when the cookie is missing or is not a
 * UUID: every value the server issues is one, so anything else is caller input
 * that must not reach the bucket hash.
 */
export function readAnonId(
  req: Pick<Request, 'cookies'>,
  secure: boolean
): string | null {
  const value = readHostCookie(req, ANON_ID_COOKIE, secure);
  return value !== undefined && ANON_ID_PATTERN.test(value) ? value : null;
}

export function writeAnonId(
  res: Response,
  value: string,
  secure: boolean
): void {
  setHostCookie(res, ANON_ID_COOKIE, value, secure, {
    // Bucketing is resolved server-side from the cookie, so no browser script
    // needs to read it.
    httpOnly: true,
    sameSite: 'lax',
    maxAge: ANON_ID_MAX_AGE_MS
  });
}
