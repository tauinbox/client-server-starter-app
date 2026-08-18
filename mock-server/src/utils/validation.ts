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

/** The `@MinLength(8) @MaxLength(128)` pair every password field carries. */
export function passwordLengthError(value: unknown): string | null {
  return (
    validateMinLength(value, 8, 'password') ??
    validateMaxLength(value, 128, 'password')
  );
}

/**
 * Mirrors `whitelist` + `forbidNonWhitelisted`. class-validator whitelists
 * before it validates, so a caller must report these ahead of its field errors.
 */
export function unknownPropertyErrors(
  body: unknown,
  allowed: readonly string[]
): string[] {
  if (typeof body !== 'object' || body === null) return [];
  return Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((key) => `property ${key} should not exist`);
}

/**
 * How the DTO marks the field optional. `@IsOptional()` (`nullable`) skips the
 * remaining validators for an explicit `null` as well as an omitted property;
 * `@ValidateIf(propertyIsDefined)` (`definedOnly`) skips only the omitted one,
 * so a `null` falls through and fails the validators the way any other
 * wrong-typed value does.
 */
export type OptionalMode = 'nullable' | 'definedOnly';

function isSkipped(
  value: unknown,
  optional: OptionalMode | undefined
): boolean {
  if (optional === undefined) return false;
  return value === undefined || (optional === 'nullable' && value === null);
}

interface TrimmedStringRules {
  /** Omitted for a field carrying no `@MinLength`. */
  min?: number;
  max: number;
  optional?: OptionalMode;
}

/**
 * Mirrors `@Transform(trim) @IsString() @MinLength(min) @MaxLength(max)`.
 * Decorators apply bottom-up, so a value failing several of them is reported
 * MaxLength, MinLength, IsString - and the trim runs before the caps.
 */
export function trimmedStringErrors(
  field: string,
  value: unknown,
  rules: TrimmedStringRules
): string[] {
  if (isSkipped(value, rules.optional)) return [];

  const trimmed = typeof value === 'string' ? value.trim() : value;
  const errors: string[] = [];
  const tooLong = validateMaxLength(trimmed, rules.max, field);
  if (tooLong) errors.push(tooLong);
  if (rules.min !== undefined) {
    const tooShort = validateMinLength(trimmed, rules.min, field);
    if (tooShort) errors.push(tooShort);
  }
  if (typeof value !== 'string') errors.push(`${field} must be a string`);
  return errors;
}

interface IntRules {
  min: number;
  /** Omitted for a field carrying no `@Max`. */
  max?: number;
  optional?: OptionalMode;
}

/** Mirrors `@IsInt() @Min(min) @Max(max)`, reported Max, Min, IsInt. */
export function intErrors(
  field: string,
  value: unknown,
  rules: IntRules
): string[] {
  if (isSkipped(value, rules.optional)) return [];

  const numeric = typeof value === 'number' ? value : null;
  const errors: string[] = [];
  if (rules.max !== undefined && (numeric === null || numeric > rules.max)) {
    errors.push(`${field} must not be greater than ${rules.max}`);
  }
  if (numeric === null || numeric < rules.min) {
    errors.push(`${field} must not be less than ${rules.min}`);
  }
  if (numeric === null || !Number.isInteger(numeric)) {
    errors.push(`${field} must be an integer number`);
  }
  return errors;
}

/**
 * Byte-for-byte the `all` entry of validator.js's uuid patterns, which is what
 * `@IsUUID()` validates a body field against. It is stricter than the pattern
 * `ParseUUIDPipe` applies to a route param (`UUID_PATTERN` in utils/mock-id):
 * the version nibble must be 1-8 and the variant nibble 8/9/a/b, so an id like
 * `11111111-1111-1111-1111-111111111111` passes as a param and fails in a body.
 */
const BODY_UUID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

/** Mirrors `@IsUUID()` with no version, i.e. validator.js `all`. */
export function uuidErrors(field: string, value: unknown): string[] {
  return typeof value === 'string' && BODY_UUID_PATTERN.test(value)
    ? []
    : [`${field} must be a UUID`];
}

/**
 * Byte-for-byte validator.js's non-strict `iso8601` pattern, which is what
 * `@IsISO8601()` applies with no options. Non-strict leaves the calendar
 * unchecked, so `2009-02-31` is accepted by both servers and rolls over.
 */
const ISO8601_PATTERN =
  /^([+-]?\d{4}(?!\d{2}\b))((-?)((0[1-9]|1[0-2])(\3([12]\d|0[1-9]|3[01]))?|W([0-4]\d|5[0-3])(-?[1-7])?|(00[1-9]|0[1-9]\d|[12]\d{2}|3([0-5]\d|6[1-6])))([T\s]((([01]\d|2[0-3])((:?)[0-5]\d)?|24:?00)([.,]\d+(?!:))?)?(\17[0-5]\d([.,]\d+)?)?([zZ]|([+-])([01]\d|2[0-3]):?([0-5]\d)?)?)?)?$/;

/** Mirrors `@IsOptional() @IsISO8601()`. */
export function iso8601Errors(field: string, value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return typeof value === 'string' && ISO8601_PATTERN.test(value)
    ? []
    : [`${field} must be a valid ISO 8601 date string`];
}

/** Mirrors `@IsIn(values)`. */
export function oneOfErrors(
  field: string,
  value: unknown,
  values: readonly string[],
  optional?: OptionalMode
): string[] {
  if (isSkipped(value, optional)) return [];
  return values.includes(value as string)
    ? []
    : [`${field} must be one of the following values: ${values.join(', ')}`];
}
