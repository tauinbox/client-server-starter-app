import type { HttpRequest } from '@angular/common/http';

/**
 * The access token must only ever be sent to our own backend: relative URLs
 * resolve against the app origin, absolute URLs must match it exactly.
 * Unparseable URLs fail closed (no token attached).
 */
export function isSameOriginUrl(
  request: HttpRequest<unknown>,
  baseOrigin: string
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(request.url, baseOrigin);
  } catch {
    return false;
  }
  return parsed.origin === baseOrigin;
}
