import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

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
  const isProduction = process.env['ENVIRONMENT'] === 'production';
  res.cookie(ANON_ID_COOKIE, value, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/'
  });
  cookies[ANON_ID_COOKIE] = value;
  req.cookies = cookies;
  next();
}
