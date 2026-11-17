/**
 * The schema checks of the JSON contracts in `contracts/` (the route entries
 * and the request scenarios). Each contract type gets one `FieldChecks` table:
 * one check for each field, so a new field with no check does not compile, and
 * a JSON key with no check is an unknown key. A field that takes a value from
 * a closed list uses `oneOf` with that list, never a check of the type alone.
 */

/** The problems of one field value, as text. */
export type FieldCheck = (value: unknown) => string[];

/** One check for each field of `T`, the optional fields included. */
export type FieldChecks<T> = { readonly [K in keyof Required<T>]: FieldCheck };

/** The HTTP methods of the API routes. */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export function includes<T extends string>(
  list: readonly T[],
  value: unknown
): value is T {
  return (
    typeof value === 'string' && (list as readonly string[]).includes(value)
  );
}

export function oneOf(label: string, values: readonly string[]): FieldCheck {
  return (value) => {
    if (value === undefined) return ['is missing'];

    return includes(values, value)
      ? []
      : [`unknown ${label} ${JSON.stringify(value)}`];
  };
}

/** A string that matches `pattern`; `label` names the form in the message. */
export function matches(label: string, pattern: RegExp): FieldCheck {
  return (value) =>
    typeof value === 'string' && pattern.test(value)
      ? []
      : [`${JSON.stringify(value)} is not ${label}`];
}

export function optional(check: FieldCheck): FieldCheck {
  return (value) => (value === undefined ? [] : check(value));
}

export function nullOr(check: FieldCheck): FieldCheck {
  return (value) => (value === null ? [] : check(value));
}

export function listOf(check: FieldCheck): FieldCheck {
  return (value) =>
    Array.isArray(value) ? value.flatMap(check) : ['is not a list'];
}

export function objectOf<T>(checks: FieldChecks<T>): FieldCheck {
  return (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return ['is not an object'];
    }

    const record = value as Record<string, unknown>;

    return [
      ...Object.keys(record)
        .filter((key) => !Object.hasOwn(checks, key))
        .map((key) => `unknown key "${key}"`),
      ...Object.entries<FieldCheck>(checks).flatMap(([key, check]) =>
        check(record[key]).map((problem) => `${key}: ${problem}`)
      )
    ];
  };
}

export const text: FieldCheck = (value) =>
  typeof value === 'string' && value !== ''
    ? []
    : ['is not a non-empty string'];

export const flag: FieldCheck = (value) =>
  typeof value === 'boolean' ? [] : ['is not true or false'];

export const httpStatus: FieldCheck = (value) =>
  Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599
    ? []
    : ['is not an HTTP status'];

/** `METHOD /path`, the key of a route entry. */
export const routeLine = matches(
  '"METHOD /path"',
  new RegExp(`^(${HTTP_METHODS.join('|')}) /\\S+$`)
);
