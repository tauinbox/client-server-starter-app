/**
 * Set by POST /auth/oauth/link-init and read back on the provider callback, so
 * the callback can tell an account-link attempt from a plain OAuth login. The
 * path scopes it to the OAuth routes, which is why the callback still receives
 * it. Shared with the provider guard, which needs the same signal to decide
 * where a Passport-level failure sends the browser.
 */
export const OAUTH_LINK_COOKIE = 'oauth_link';
export const OAUTH_LINK_COOKIE_PATH = '/api/v1/auth/oauth';
