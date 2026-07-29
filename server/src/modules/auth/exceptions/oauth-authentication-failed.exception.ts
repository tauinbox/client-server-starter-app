/**
 * Key the client's login page maps to a user-facing message. Anything it does
 * not recognise falls back to the same generic text, so one key covers every
 * Passport-level failure.
 */
export const OAUTH_ERROR_AUTH_FAILED = 'auth_failed';

/**
 * Raised when Passport rejects an OAuth request - a denied consent screen, an
 * expired state cookie, a failed code exchange. It exists so the failure can be
 * turned into a redirect back to the client instead of a JSON error body on the
 * API origin: the browser is mid-navigation here, not calling an API.
 */
export class OAuthAuthenticationFailedException extends Error {
  constructor(
    readonly oauthError: string,
    readonly reason?: unknown
  ) {
    super(`OAuth authentication failed (${oauthError})`);
    this.name = 'OAuthAuthenticationFailedException';
  }
}
