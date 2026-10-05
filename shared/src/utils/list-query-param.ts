import { MAX_LIST_FILTER_LENGTH } from '../constants/list-query.constants';
import { MAX_PAGE_SIZE } from '../constants/pagination.constants';
import { BODY_UUID_PATTERN } from '../constants/uuid.constants';
import type {
  ListFilterDefinition,
  ListFilterKind,
  ListFilterValueMap
} from '../types/list-query.types';

type ParamParser<K extends ListFilterKind> = (
  raw: string,
  definition: ListFilterDefinition
) => ListFilterValueMap[K] | undefined;

function parseBoolean(raw: string): boolean | undefined {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function parseText(raw: string): string | undefined {
  return raw !== '' && raw.length <= MAX_LIST_FILTER_LENGTH ? raw : undefined;
}

const PARAM_PARSERS: { [K in ListFilterKind]: ParamParser<K> } = {
  boolean: parseBoolean,
  isSet: parseBoolean,
  inFuture: parseBoolean,
  contains: parseText,
  scopeIncludes: (raw, { values = [] }) =>
    values.includes(raw) ? raw : undefined,
  uuidList: (raw) => {
    const ids = raw.split(',');
    return ids.length <= MAX_PAGE_SIZE &&
      ids.every((id) => BODY_UUID_PATTERN.test(id))
      ? ids
      : undefined;
  }
};

function parseParam<K extends ListFilterKind>(
  kind: K,
  raw: string,
  definition: ListFilterDefinition
): ListFilterValueMap[K] | undefined {
  return PARAM_PARSERS[kind](raw, definition);
}

/**
 * Reads one list param from a string that nothing has validated yet, such as
 * a URL. The result is `undefined` for every value that the server rejects
 * with a 400 or reads as unset, so the caller can drop the param instead of
 * sending it.
 */
export function parseListParam(
  definition: ListFilterDefinition,
  raw: string
): unknown {
  return parseParam(definition.kind, raw, definition);
}

/** The `q` of a list, read the same way as `parseListParam`. */
export function parseListSearch(raw: string): string | undefined {
  return parseText(raw);
}

/** The string form of a parsed value, the inverse of `parseListParam`. */
export function formatListParam(value: unknown): string {
  return Array.isArray(value) ? value.join(',') : String(value);
}
