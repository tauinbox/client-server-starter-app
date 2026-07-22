/**
 * A post-login redirect target is only followed when it is an app-internal
 * path: it must start with a single '/' and contain no '//' anywhere, which
 * would make it protocol-relative (`//evil.example`) and send the user off-site.
 */
export function isSafeReturnUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith('/') && !url.includes('//');
}
