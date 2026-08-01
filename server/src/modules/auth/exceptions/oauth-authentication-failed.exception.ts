/**
 * Keys the client maps to a user-facing message. Anything it does not
 * recognise falls back to the same generic text.
 */
export const OAUTH_ERROR_AUTH_FAILED = 'auth_failed';
export const OAUTH_ERROR_CANCELLED = 'oauth_cancelled';

/**
 * Where the browser is sent after a failure. A cancelled or failed link flow
 * started on the profile page belongs back there, not on the login page of an
 * already authenticated user. Both members are literals chosen in code - no
 * request value ever reaches the redirect.
 */
export type OAuthFailureRedirect = '/login' | '/profile';

/**
 * Raised when Passport rejects an OAuth request - a denied consent screen, an
 * expired state cookie, a failed code exchange. It exists so the failure can be
 * turned into a redirect back to the client instead of a JSON error body on the
 * API origin: the browser is mid-navigation here, not calling an API.
 */
export class OAuthAuthenticationFailedException extends Error {
  constructor(
    readonly oauthError: string,
    readonly reason?: unknown,
    readonly redirectPath: OAuthFailureRedirect = '/login'
  ) {
    super(`OAuth authentication failed (${oauthError})`);
    this.name = 'OAuthAuthenticationFailedException';
  }
}
