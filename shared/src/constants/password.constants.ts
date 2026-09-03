export const MIN_PASSWORD_LENGTH = 8;

export const MAX_PASSWORD_LENGTH = 128;

/**
 * bcrypt reads at most 72 bytes of its input and ignores the rest, so two
 * different passwords that share a 72-byte prefix open the same account.
 * A path that SETS a password caps the input here.
 *
 * A path that VERIFIES a password keeps MAX_PASSWORD_LENGTH. A hash that is
 * already stored was computed over the same truncated prefix, and bcrypt
 * truncates the submitted value identically, so the owner of a long legacy
 * password still signs in. A lower cap on that path would lock them out.
 */
export const MAX_NEW_PASSWORD_BYTES = 72;

/**
 * The character cap on the same SET paths. It is the byte cap, because a
 * character is never fewer than one byte. An all-ASCII password therefore
 * fails on this ordinary length rule, and the byte rule only ever reports a
 * value that holds multibyte characters.
 */
export const MAX_NEW_PASSWORD_LENGTH = MAX_NEW_PASSWORD_BYTES;
