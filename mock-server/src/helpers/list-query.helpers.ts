import type { Response } from 'express';
import {
  ErrorKeys,
  UUID_PATTERN,
  MAX_LIST_FILTER_LENGTH,
  MAX_PAGE_SIZE
} from '@app/shared/constants';
import { parseCursor } from '@app/shared/utils/cursor';
import type {
  ListFilterDefinition,
  ListFilterKind,
  ListFilterValueMap,
  ListFilters,
  ListQuery,
  ListQuerySpec
} from '@app/shared/types';
import {
  cursorPaginate,
  cursorQueryErrors,
  parseCursorQuery,
  type CursorPaginatedBody
} from './pagination.helpers';

/** Mirrors the boolean @Transform: an empty param reads as unset. */
export function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return undefined;
}

/** Mirrors the `toIdList` @Transform: a comma-separated string is split. */
function parseIdList(value: unknown): unknown {
  return typeof value === 'string' ? value.split(',') : value;
}

type FilterKindHandler<K extends ListFilterKind> = {
  /** The class-validator messages, in the order the server reports them. */
  errors: (
    name: string,
    value: unknown,
    definition: ListFilterDefinition
  ) => string[];
  /** Called only for a value that passed `errors`. */
  parse: (value: unknown) => ListFilterValueMap[K] | undefined;
  matches: (fieldValue: unknown, wanted: ListFilterValueMap[K]) => boolean;
};

function textErrors(name: string, value: unknown): string[] {
  if (typeof value === 'string') {
    return value.length > MAX_LIST_FILTER_LENGTH
      ? [
          `${name} must be shorter than or equal to ${MAX_LIST_FILTER_LENGTH} characters`
        ]
      : [];
  }
  return [
    `${name} must be shorter than or equal to ${MAX_LIST_FILTER_LENGTH} characters`,
    `${name} must be a string`
  ];
}

/** Postgres `ILIKE '%x%'`: a NULL column never matches. */
function containsText(fieldValue: unknown, wanted: string): boolean {
  if (fieldValue === null || fieldValue === undefined) return false;
  return String(fieldValue).toLowerCase().includes(wanted.toLowerCase());
}

function booleanErrors(name: string, value: unknown): string[] {
  return value === '' || parseOptionalBoolean(value) !== undefined
    ? []
    : [`${name} must be a boolean value`];
}

function isSetValue(fieldValue: unknown): boolean {
  return fieldValue !== null && fieldValue !== undefined;
}

const FILTER_KINDS: { [K in ListFilterKind]: FilterKindHandler<K> } = {
  boolean: {
    errors: booleanErrors,
    parse: parseOptionalBoolean,
    matches: (fieldValue, wanted) => fieldValue === wanted
  },
  isSet: {
    errors: booleanErrors,
    parse: parseOptionalBoolean,
    matches: (fieldValue, wanted) => isSetValue(fieldValue) === wanted
  },
  inFuture: {
    errors: booleanErrors,
    parse: parseOptionalBoolean,
    // Postgres `col > now()`: a NULL timestamp is not in the future.
    matches: (fieldValue, wanted) =>
      (isSetValue(fieldValue) &&
        new Date(String(fieldValue)).getTime() > Date.now()) === wanted
  },
  scopeIncludes: {
    errors: (name, value, { values = [] }) =>
      typeof value === 'string' && values.includes(value)
        ? []
        : [`${name} must be one of the following values: ${values.join(', ')}`],
    parse: String,
    matches: (fieldValue, wanted) =>
      Array.isArray(fieldValue) &&
      (fieldValue.length === 0 || fieldValue.includes(wanted))
  },
  contains: {
    errors: textErrors,
    parse: (value) => (value === '' ? undefined : String(value)),
    matches: containsText
  },
  uuidList: {
    errors: (name, value) => {
      const ids = parseIdList(value);
      if (!Array.isArray(ids)) return [`${name} must be an array`];
      const errors: string[] = [];
      if (!ids.every((id) => typeof id === 'string' && UUID_PATTERN.test(id))) {
        errors.push(`each value in ${name} must be a UUID`);
      }
      if (ids.length > MAX_PAGE_SIZE) {
        errors.push(
          `${name} must contain no more than ${MAX_PAGE_SIZE} elements`
        );
      }
      return errors;
    },
    parse: (value) => (parseIdList(value) as string[]).map(String),
    matches: (fieldValue, wanted) =>
      wanted.some((id) => id.toLowerCase() === String(fieldValue).toLowerCase())
  }
};

/** The messages of one param of `kind`, as the server reports them. */
function paramErrors(
  definitions: Readonly<Record<string, ListFilterDefinition>> | undefined,
  query: Record<string, unknown>
): string[] {
  return Object.entries(definitions ?? {}).flatMap(([name, definition]) =>
    query[name] === undefined
      ? []
      : FILTER_KINDS[definition.kind].errors(name, query[name], definition)
  );
}

/** Every query param a list built from `spec` accepts beside the paging ones. */
export function listQueryKeys(spec: ListQuerySpec): string[] {
  return [
    ...(spec.search.length > 0 ? ['q'] : []),
    ...Object.keys(spec.filters),
    ...Object.keys(spec.params ?? {})
  ];
}

/**
 * Mirrors `ListCursorQueryDto(spec)` under the server's ValidationPipe: the
 * paging messages first (with `sortBy` limited to `spec.sort`), then the
 * `params` (the server declares them on a subclass, and reports own
 * properties first), then `q`, then each filter in definition order.
 */
export function listQueryErrors(
  query: Record<string, unknown>,
  spec: ListQuerySpec
): string[] {
  return [
    ...cursorQueryErrors(query, {
      extraAllowed: listQueryKeys(spec),
      sortColumns: spec.sort
    }),
    ...paramErrors(spec.params, query),
    ...(spec.search.length === 0 || query['q'] === undefined
      ? []
      : textErrors('q', query['q'])),
    ...paramErrors(spec.filters, query)
  ];
}

/** Call only after `listQueryErrors` returned none. */
export function parseListQuery<S extends ListQuerySpec>(
  query: Record<string, unknown>,
  spec: S
): ListFilters<S> {
  const parsed: Record<string, unknown> = {};
  if (typeof query['q'] === 'string' && query['q'] !== '') {
    parsed['q'] = query['q'];
  }
  const definitions = { ...spec.filters, ...spec.params };
  for (const [name, definition] of Object.entries(definitions)) {
    if (query[name] === undefined) continue;
    parsed[name] = FILTER_KINDS[definition.kind].parse(query[name]);
  }
  // Each key was parsed by the handler of the kind that `spec` gives it.
  return parsed as ListFilters<S>;
}

function matchesFilter<K extends ListFilterKind>(
  kind: K,
  fieldValue: unknown,
  wanted: unknown
): boolean {
  // parseListQuery produced `wanted` for this kind.
  return FILTER_KINDS[kind].matches(
    fieldValue,
    wanted as ListFilterValueMap[K]
  );
}

/**
 * Mirrors `applyListQuery`: a row passes when any search field contains `q`
 * and every filter that is set matches.
 */
export function filterByListQuery<T extends object, S extends ListQuerySpec>(
  items: T[],
  spec: S,
  query: ListQuery<S>
): T[] {
  const values: Readonly<Record<string, unknown>> = query;
  const { q } = query;
  return items.filter((item) => {
    if (
      q &&
      !spec.search.some((field) => containsText(Reflect.get(item, field), q))
    ) {
      return false;
    }
    return Object.entries(spec.filters).every(([name, definition]) => {
      const wanted = values[name];
      if (wanted === undefined) return true;
      return matchesFilter(
        definition.kind,
        Reflect.get(item, definition.field ?? name),
        wanted
      );
    });
  });
}

/**
 * Mirrors `decodeCursor`, which the service runs after the query DTO passed:
 * a cursor that does not decode is a 400. Call it after `listQueryErrors`.
 */
export function rejectInvalidCursor(
  res: Response,
  query: Record<string, unknown>
): boolean {
  const { cursor } = parseCursorQuery(query);
  if (!cursor || parseCursor(cursor)) return false;
  res.status(400).json({
    message: 'Invalid cursor',
    statusCode: 400,
    errorKey: ErrorKeys.GENERAL.INVALID_CURSOR
  });
  return true;
}

/**
 * Mirrors `applyList`: the search and filters of `query`, then the keyset
 * page that `query` asks for. Filter `items` by ability and by the list's own
 * `params` first. Call it only after `listQueryErrors` returned none.
 */
export function listPage<T extends { id: string }, S extends ListQuerySpec>(
  items: T[],
  spec: S,
  query: Record<string, unknown>
): CursorPaginatedBody<T> {
  return cursorPaginate(
    filterByListQuery(items, spec, parseListQuery(query, spec)),
    parseCursorQuery(query)
  );
}
