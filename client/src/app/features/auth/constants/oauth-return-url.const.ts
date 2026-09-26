/**
 * A provider sign-in or link leaves the app and comes back through the OAuth
 * callback as a full page load, so the page to return to waits in session
 * storage under this key.
 */
export const OAUTH_RETURN_URL_KEY = 'oauth_return_url';
