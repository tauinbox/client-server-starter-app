/**
 * Set by POST /auth/oauth/link-init and read back on the provider callback, so
 * the callback can tell an account-link attempt from a plain OAuth login.
 * Shared with the provider guard, which needs the same signal to decide where a
 * Passport-level failure sends the browser.
 */
export const OAUTH_LINK_COOKIE = 'oauth_link';

/**
 * Set by POST /auth/oauth/reauth-init and read back on the provider callback.
 * It says the round trip is a step-up re-authentication rather than a login or
 * a link, so the callback mints a proof instead of a session.
 */
export const OAUTH_REAUTH_COOKIE = 'oauth_reauth';

/**
 * Both intents live under the OAuth routes, which is why the callback still
 * receives them. A cookie is identified by name plus path, so this value has to
 * match everywhere one of them is written or cleared.
 */
export const OAUTH_INTENT_COOKIE_PATH = '/api/v1/auth/oauth';

/**
 * The step-up proof itself, minted once a factor is verified and consumed by
 * the sensitive action. Its path covers the auth routes rather than the OAuth
 * ones, because the action that consumes it is not an OAuth route.
 */
export const REAUTH_PROOF_COOKIE = 'reauth_proof';
export const REAUTH_PROOF_COOKIE_PATH = '/api/v1/auth';
