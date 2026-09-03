import { MAX_NEW_PASSWORD_BYTES } from '../constants/password.constants';

/**
 * bcrypt reads at most MAX_NEW_PASSWORD_BYTES bytes, and the threshold is
 * bytes, not characters: a UTF-8 Cyrillic letter is two bytes, so a
 * 37-character Russian password is already over the limit.
 *
 * TextEncoder is deliberate. Buffer is Node-only and this file is compiled
 * into the Angular bundle, where a Node import breaks the build.
 */
const encoder = new TextEncoder();

export function passwordByteLength(value: string): number {
  return encoder.encode(value).length;
}

/**
 * A non-string is not a violation here. Every field that carries this rule
 * also carries the class-validator type and length rules that report it.
 */
export function exceedsPasswordByteLimit(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    passwordByteLength(value) > MAX_NEW_PASSWORD_BYTES
  );
}

/**
 * One message for the server DTOs and for the mock, so the two stay in step.
 * It describes what the user did, because "72 bytes" means nothing to a
 * person who typed 40 characters.
 */
export function passwordByteLimitMessage(field: string): string {
  return (
    `${field} is too long: some characters count as more than one byte, ` +
    `so it must be at most ${MAX_NEW_PASSWORD_BYTES} bytes`
  );
}
