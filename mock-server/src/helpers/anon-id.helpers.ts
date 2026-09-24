import type { Request, Response } from 'express';
import { ANON_ID_PATTERN, requiresSecureCookies } from '@app/shared/constants';

// Mirrors server/src/modules/feature-flags/utils/anon-id-cookie.ts. The mock
// only ever serves http://localhost, so it keeps the bare cookie name.
export const ANON_ID_COOKIE = 'nxs_anon_id';
const ANON_ID_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

// Every id the server issues is a UUID; any other value is treated as absent.
export function readAnonId(req: Request): string | null {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[
    ANON_ID_COOKIE
  ];
  return typeof value === 'string' && ANON_ID_PATTERN.test(value)
    ? value
    : null;
}

export function writeAnonId(res: Response, value: string): void {
  // An unset ENVIRONMENT is local here: a Secure cookie would be dropped on
  // http://localhost and bucketing would restart on every request.
  const secure = requiresSecureCookies(process.env['ENVIRONMENT'] ?? 'local');
  res.cookie(ANON_ID_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: ANON_ID_MAX_AGE_MS,
    path: '/'
  });
}
