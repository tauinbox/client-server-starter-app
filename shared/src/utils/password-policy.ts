import {
  MIN_PASSWORD_CONTEXT_WORD_LENGTH,
  PASSWORD_PRODUCT_WORDS
} from '../constants/password.constants';
import { COMMON_PASSWORDS } from '../data/common-passwords';

/** The caller's own fields that a password must not contain. */
export interface PasswordContext {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export type LocalPasswordRefusal = 'common' | 'context';

/**
 * Splits on anything that is not a letter or a digit, so "john.smith" yields
 * "john" and "smith" as well as the whole value.
 */
function wordsOf(value: string | null | undefined): string[] {
  if (!value) return [];
  const lower = value.toLowerCase();
  return [lower, ...lower.split(/[^\p{L}\p{N}]+/u)];
}

function contextWords(context: PasswordContext): string[] {
  const localPart = context.email?.split('@')[0];
  return [
    ...PASSWORD_PRODUCT_WORDS,
    ...wordsOf(localPart),
    ...wordsOf(context.firstName),
    ...wordsOf(context.lastName)
  ].filter((word) => word.length >= MIN_PASSWORD_CONTEXT_WORD_LENGTH);
}

/**
 * The check that needs no network, run ahead of the breach range lookup. That
 * lookup fails open during an outage, and this check keeps the most common
 * passwords refused while it does.
 *
 * Server and mock-server only: the list it reads is too large for the client
 * bundle.
 */
export function localPasswordRefusal(
  password: string,
  context: PasswordContext
): LocalPasswordRefusal | null {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'common';
  if (contextWords(context).some((word) => lower.includes(word))) {
    return 'context';
  }
  return null;
}

/** One message for the server and the mock, so the two stay in step. */
export const PASSWORD_TOO_COMMON_MESSAGE =
  'This password is too common, or it contains your name, your email ' +
  'address or the product name. Please choose a different one.';
