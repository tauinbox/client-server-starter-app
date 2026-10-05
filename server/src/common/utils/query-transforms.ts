/**
 * Recognises the two spellings a query string can carry for a boolean and
 * leaves anything else untouched, so `@IsBoolean()` rejects it with a 400
 * instead of the filter being silently dropped. An absent or empty parameter
 * (`?isActive=`) stays `undefined` - the same "filter not set" reading the
 * string filters give an empty value.
 */
export function toOptionalBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  if (value === '' || value === null || value === undefined) return undefined;
  return value;
}

/**
 * An empty `?ids=` becomes `['']` and fails the UUID check, so it can never
 * read as "no id filter" and widen the result to every row.
 */
export function toIdList({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.split(',') : value;
}
