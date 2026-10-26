import {
  UUID_PATTERN,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  SUPPORTED_LOCALES
} from '@app/shared/constants';
import { normalizeEmail } from '@app/shared/utils/email';
import isEmail from 'validator/lib/isEmail';

/**
 * Mirrors `@IsEmail()`, which is `typeof value === 'string' && isEmail(value)`
 * over the same validator.js function with the default options
 * (`class-validator/cjs/decorator/string/IsEmail.js`). The package is imported
 * directly, not through `shared/src`, because the client Playwright fixture
 * loads this server in process and a bare specifier inside `shared/src` has no
 * `node_modules` to resolve from. The shared corpus in
 * `shared/src/test-fixtures/email-address-corpus.ts` keeps the two copies of
 * validator.js on the same verdicts.
 *
 * A regular expression here accepted thirteen shapes that the server answers
 * with 400, among them a local part over 64 characters, a hyphen-edged domain
 * label and a single-character last label.
 */
export function isValidEmail(email: unknown): boolean {
  return typeof email === 'string' && isEmail(email);
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

interface StringRules {
  /** Omitted for a field carrying no `@MinLength`. */
  min?: number;
  max: number;
  /**
   * The field carries `@IsNotEmpty()`. class-validator treats only `''`, null
   * and undefined as empty, so a number passes it and fails `@IsString()`
   * alone. It sits at the top of the decorator list, so it is reported last.
   */
  notEmpty?: boolean;
  /**
   * The DTO lists `@IsString()` above `@IsNotEmpty()`, so IsString is
   * reported last.
   */
  isStringOnTop?: boolean;
  optional?: OptionalMode;
}

/**
 * Mirrors `@IsNotEmpty() @IsString() @MinLength(min) @MaxLength(max)`.
 * Decorators apply bottom-up, so a value failing several of them is reported
 * MaxLength, MinLength, IsString, IsNotEmpty, or MaxLength, MinLength,
 * IsNotEmpty, IsString with `isStringOnTop`.
 */
export function stringErrors(
  field: string,
  value: unknown,
  rules: StringRules
): string[] {
  if (isSkipped(value, rules.optional)) return [];

  const errors: string[] = [];
  const tooLong = validateMaxLength(value, rules.max, field);
  if (tooLong) errors.push(tooLong);
  if (rules.min !== undefined) {
    const tooShort = validateMinLength(value, rules.min, field);
    if (tooShort) errors.push(tooShort);
  }
  const notString =
    typeof value !== 'string' ? [`${field} must be a string`] : [];
  const empty =
    rules.notEmpty && (value === '' || value === null || value === undefined)
      ? [`${field} should not be empty`]
      : [];
  return rules.isStringOnTop
    ? [...errors, ...empty, ...notString]
    : [...errors, ...notString, ...empty];
}

/**
 * Mirrors `@IsString() @Length(length, length)`, reported Length, IsString.
 * class-validator picks the Length message from the raw value: a falsy or
 * shorter one is "longer than", a longer one is "shorter than", and a value
 * with no `length` (a number) gets both bounds in one message.
 */
export function fixedLengthStringErrors(
  field: string,
  value: unknown,
  length: number,
  optional?: OptionalMode
): string[] {
  if (isSkipped(value, optional)) return [];
  if (typeof value === 'string' && value.length === length) return [];

  const size = (value as { length?: unknown } | null | undefined)?.length;
  const errors = [
    !value || (typeof size === 'number' && size < length)
      ? `${field} must be longer than or equal to ${length} characters`
      : typeof size === 'number' && size > length
        ? `${field} must be shorter than or equal to ${length} characters`
        : `${field} must be longer than or equal to ${length} and shorter than or equal to ${length} characters`
  ];
  if (typeof value !== 'string') errors.push(`${field} must be a string`);
  return errors;
}

/**
 * Mirrors `@IsString() @Matches(pattern)`, reported Matches, IsString.
 */
export function matchesErrors(
  field: string,
  value: unknown,
  pattern: RegExp
): string[] {
  const errors: string[] = [];
  if (typeof value !== 'string' || !pattern.test(value)) {
    errors.push(`${field} must match ${pattern} regular expression`);
  }
  if (typeof value !== 'string') errors.push(`${field} must be a string`);
  return errors;
}

/**
 * Mirrors `@Transform(normalizeEmail) @IsEmail() @MaxLength(MAX_EMAIL_LENGTH)`,
 * the chain every address field on the server carries. Both validators run on
 * every body, so a value that fails both is reported MaxLength, IsEmail - a
 * route that answers with the first failure it finds sends one message where
 * the server sends two.
 *
 * Measured against the application's own `ValidationPipe` options: an absent
 * field, a null and any non-string fail the length cap as well and give two
 * messages; a string that normalizes to empty, or is simply malformed, gives
 * one. Pass the raw body value - the transform belongs to the same chain.
 */
export function emailErrors(
  field: string,
  value: unknown,
  optional?: OptionalMode
): string[] {
  if (isSkipped(value, optional)) return [];

  const transformed = normalizeEmail(value) ?? value;
  const errors: string[] = [];
  const tooLong = validateMaxLength(transformed, MAX_EMAIL_LENGTH, field);
  if (tooLong) errors.push(tooLong);
  if (!isValidEmail(transformed)) errors.push(`${field} must be an email`);
  return errors;
}

/** The `@Transform(trim)` of the `name` field of the user DTOs. */
export function trimName(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Mirrors `@IsNotEmpty() @MaxLength(MAX_NAME_LENGTH)` on a `name` that
 * `trimName` returned. Decorators apply bottom-up, so MaxLength is reported
 * before IsNotEmpty.
 */
export function nameErrors(value: unknown, optional?: OptionalMode): string[] {
  if (isSkipped(value, optional)) return [];
  const errors: string[] = [];
  const tooLong = validateMaxLength(value, MAX_NAME_LENGTH, 'name');
  if (tooLong) errors.push(tooLong);
  if (value === '' || value === null || value === undefined) {
    errors.push('name should not be empty');
  }
  return errors;
}

/**
 * Mirrors `@MinLength(MIN_PASSWORD_LENGTH) @MaxLength(MAX_PASSWORD_LENGTH)`,
 * the length rules of every field that SETS a password, reported MaxLength,
 * MinLength. A field that only VERIFIES a password keeps MAX_PASSWORD_LENGTH
 * and does not come here.
 */
export function passwordLengthErrors(
  value: unknown,
  optional?: OptionalMode
): string[] {
  if (isSkipped(value, optional)) return [];
  return [
    validateMaxLength(value, MAX_PASSWORD_LENGTH, 'password'),
    validateMinLength(value, MIN_PASSWORD_LENGTH, 'password')
  ].filter((error): error is string => error !== null);
}

/**
 * Mirrors `@IsNotEmpty() @MinLength(MIN_PASSWORD_LENGTH)
 * @MaxLength(MAX_PASSWORD_LENGTH)` of `CreateUserDto.password`, reported
 * MaxLength, MinLength, IsNotEmpty. The field has no `@IsString()`, so a number
 * fails the two caps only.
 */
export function newPasswordErrors(
  value: unknown,
  optional?: OptionalMode
): string[] {
  if (isSkipped(value, optional)) return [];
  const errors = passwordLengthErrors(value);
  if (value === '' || value === null || value === undefined) {
    errors.push('password should not be empty');
  }
  return errors;
}

/**
 * Mirrors `@Transform(trim) @IsNotEmpty() @IsString() @MinLength(min)
 * @MaxLength(max)`. The trim runs before the caps, so a whitespace-only value
 * reaches `@IsNotEmpty()` as an empty string. A field with no `@Transform(trim)` takes
 * `stringErrors` instead, because trimming there would accept a value the
 * server rejects on length.
 */
export function trimmedStringErrors(
  field: string,
  value: unknown,
  rules: StringRules
): string[] {
  if (isSkipped(value, rules.optional)) return [];

  const trimmed = typeof value === 'string' ? value.trim() : value;
  return stringErrors(field, trimmed, {
    min: rules.min,
    max: rules.max,
    notEmpty: rules.notEmpty
  });
}

interface StringArrayRules {
  maxItems: number;
  maxItemLength: number;
  optional?: OptionalMode;
}

/**
 * Mirrors `@IsArray() @ArrayMaxSize(maxItems) @IsString({ each: true })
 * @MaxLength(maxItemLength, { each: true })`, reported in that reverse order.
 *
 * class-validator iterates an `each` constraint over an array, a Set or a Map
 * only. Any other value is validated as if it were the single element, so
 * `'admin'` passes both `each` constraints and fails only the two array ones.
 */
export function stringArrayErrors(
  field: string,
  value: unknown,
  rules: StringArrayRules
): string[] {
  if (isSkipped(value, rules.optional)) return [];

  const isArray = Array.isArray(value);
  const items = isArray ? value : [value];
  const errors: string[] = [];
  if (
    items.some((item) => validateMaxLength(item, rules.maxItemLength, field))
  ) {
    errors.push(
      `each value in ${field} must be shorter than or equal to ${rules.maxItemLength} characters`
    );
  }
  if (items.some((item) => typeof item !== 'string')) {
    errors.push(`each value in ${field} must be a string`);
  }
  if (!isArray || value.length > rules.maxItems) {
    errors.push(
      `${field} must contain no more than ${rules.maxItems} elements`
    );
  }
  if (!isArray) errors.push(`${field} must be an array`);
  return errors;
}

/** Mirrors `@IsObject()`, which rejects an array and a null. */
export function objectErrors(
  field: string,
  value: unknown,
  optional?: OptionalMode
): string[] {
  if (isSkipped(value, optional)) return [];
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? []
    : [`${field} must be an object`];
}

/** Mirrors `@IsBoolean()`. */
export function booleanErrors(
  field: string,
  value: unknown,
  optional?: OptionalMode
): string[] {
  if (isSkipped(value, optional)) return [];
  return typeof value === 'boolean' ? [] : [`${field} must be a boolean value`];
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

/** Mirrors `@IsUUID()` with no version, i.e. validator.js `all`. */
export function uuidErrors(
  field: string,
  value: unknown,
  optional?: OptionalMode
): string[] {
  if (isSkipped(value, optional)) return [];
  return typeof value === 'string' && UUID_PATTERN.test(value)
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
