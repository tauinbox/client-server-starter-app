import type { CookieOptions, Request, Response } from 'express';

/**
 * ASVS 5.0 V3.3.1 and V3.3.3. The browser stores a `__Host-` cookie only when
 * it is Secure, has `Path=/` and has no `Domain`, so a sibling host of the
 * registrable domain can neither set it nor shadow it with a broader one.
 *
 * The browser also refuses the prefix without Secure, so the name and the flag
 * come from the same value. `local` runs on plain HTTP and keeps the bare name.
 */
export const HOST_COOKIE_PREFIX = '__Host-';

/**
 * Every cookie the server sets shares this path. A cookie is identified by name
 * plus path, so one value for all of them means a clear always matches a write.
 */
export const HOST_COOKIE_PATH = '/';

export type HostCookieOptions = Omit<
  CookieOptions,
  'path' | 'secure' | 'domain'
>;

export function cookieName(base: string, secure: boolean): string {
  return secure ? `${HOST_COOKIE_PREFIX}${base}` : base;
}

export function setHostCookie(
  res: Response,
  base: string,
  value: string,
  secure: boolean,
  options: HostCookieOptions
): void {
  res.cookie(cookieName(base, secure), value, {
    ...options,
    secure,
    path: HOST_COOKIE_PATH
  });
}

/**
 * The expiring Set-Cookie must carry Secure too: the browser applies the prefix
 * rules to it like to any other write, and silently keeps the cookie otherwise.
 */
export function clearHostCookie(
  res: Response,
  base: string,
  secure: boolean
): void {
  res.clearCookie(cookieName(base, secure), {
    secure,
    path: HOST_COOKIE_PATH
  });
}

/**
 * Reads the environment name only. In a secure environment the bare name is
 * exactly what a sibling host can plant, so it is never a fallback here.
 */
export function readHostCookie(
  req: Pick<Request, 'cookies'>,
  base: string,
  secure: boolean
): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[
    cookieName(base, secure)
  ];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
