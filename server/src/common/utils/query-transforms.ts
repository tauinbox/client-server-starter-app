import { splitIdList } from '@app/shared/utils/list-query-param';

/**
 * Recognises the two spellings a query string can carry for a boolean and
 * leaves anything else untouched, so `@IsBoolean()` rejects it as a bad query
 * param instead of the filter being silently dropped. An absent or empty
 * parameter (`?isActive=`) stays `undefined` - the same "filter not set"
 * reading the string filters give an empty value.
 */
export function toOptionalBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === true) return true;

  if (value === 'false' || value === false) return false;

  if (value === '' || value === null || value === undefined) return undefined;

  return value;
}

export function toIdList({ value }: { value: unknown }): unknown {
  return splitIdList(value);
}
