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
 * The step-up proof itself, minted once a factor is verified and consumed by
 * the sensitive action.
 */
export const REAUTH_PROOF_COOKIE = 'reauth_proof';

/**
 * The signed result of a provider callback, exchanged once by the client for
 * the session or the second-factor challenge.
 */
export const OAUTH_DATA_COOKIE = 'oauth_data';
