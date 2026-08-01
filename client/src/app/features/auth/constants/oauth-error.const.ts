/**
 * Values the server puts in `?oauth_error=`. The server picks them from a fixed
 * set (never from the provider's response), so an unlisted value is either an
 * older server or a hand-typed URL and falls back to the generic message.
 */
export const OAUTH_ERROR_CANCELLED = 'oauth_cancelled';
