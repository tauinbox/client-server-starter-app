import { TOTP_ISSUER } from './auth.constants';

export const MIN_PASSWORD_LENGTH = 8;

export const MAX_PASSWORD_LENGTH = 128;

/**
 * The product words a password must not contain, the context-specific list
 * that ASVS 6.1.2 asks the application to document. The product name is the
 * one the authenticator app shows, so the two cannot drift apart.
 */
export const PASSWORD_PRODUCT_WORDS: readonly string[] = [
  TOTP_ISSUER.toLowerCase()
];

/**
 * A context word shorter than this is not refused inside a password: a
 * three-letter name such as "ann" would refuse too many unrelated passwords.
 */
export const MIN_PASSWORD_CONTEXT_WORD_LENGTH = 4;
