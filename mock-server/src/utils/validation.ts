import { SUPPORTED_LOCALES } from '@app/shared/constants';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: unknown): boolean {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}

/**
 * Validates an optional `locale` field against the shared supported-locale list,
 * mirroring the server's `@IsIn(SUPPORTED_LOCALES)` (message and accepted values
 * stay in sync automatically when a new locale is added to the shared constant).
 * Returns an error message, or null when absent/valid.
 */
export function validateLocale(value: unknown): string | null {
  if (value === undefined) return null;
  if (
    typeof value !== 'string' ||
    !(SUPPORTED_LOCALES as readonly string[]).includes(value)
  ) {
    return `locale must be one of the following values: ${SUPPORTED_LOCALES.join(
      ', '
    )}`;
  }
  return null;
}

/**
 * Mirrors class-validator's `maxLength` / `minLength`, which treat a non-string
 * as a violation rather than throwing: the DTOs pair every length cap with
 * `@IsString()`, `@IsNotEmpty()` or `@IsEmail()`, so a null or a number is a 400
 * on the server. Reading `.length` off the raw body would be a 500 here.
 */
export function validateMaxLength(
  value: unknown,
  max: number,
  field: string
): string | null {
  if (typeof value !== 'string' || value.length > max) {
    return `${field} must be shorter than or equal to ${max} characters`;
  }
  return null;
}

export function validateMinLength(
  value: unknown,
  min: number,
  field: string
): string | null {
  if (typeof value !== 'string' || value.length < min) {
    return `${field} must be longer than or equal to ${min} characters`;
  }
  return null;
}
