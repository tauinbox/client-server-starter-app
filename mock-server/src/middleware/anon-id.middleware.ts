import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { requiresSecureCookies } from '@app/shared/constants';

export const ANON_ID_COOKIE = 'nxs_anon_id';
const COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

// Mirrors server/src/modules/feature-flags/middleware/anon-id.middleware.ts.
// Issues nxs_anon_id on first request (any route) so anonymous percentage
// bucketing converges on the same hash across page reloads.
export function anonIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const cookies = (req.cookies ?? {}) as Record<string, unknown>;
  const existing = cookies[ANON_ID_COOKIE];
  if (typeof existing === 'string' && existing !== '') {
    next();
    return;
  }
  const value = randomUUID();
  // The mock only ever serves http://localhost, so an unset ENVIRONMENT is
  // local: a Secure cookie would be dropped and bucketing would restart on
  // every request.
  const secure = requiresSecureCookies(process.env['ENVIRONMENT'] ?? 'local');
  res.cookie(ANON_ID_COOKIE, value, {
    // Matches the real server: bucketing is resolved server-side from the cookie
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/'
  });
  cookies[ANON_ID_COOKIE] = value;
  req.cookies = cookies;
  next();
}
