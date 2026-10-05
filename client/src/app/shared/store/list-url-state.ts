import type { ParamMap } from '@angular/router';
import { DEFAULT_SORT_BY, DEFAULT_SORT_ORDER } from '@app/shared/constants';
import type { ListFilters, ListQuerySpec, SortOrder } from '@app/shared/types';
import {
  formatListParam,
  parseListParam,
  parseListSearch
} from '@app/shared/utils/list-query-param';
import { isActiveFilterValue } from '@shared/utils/pagination.utils';

/**
 * The URL param prefix of every list: `flags.q`, `users.sortBy`. One key per
 * list (one store), never per route or page, so a page that gets a second or a
 * nested list keeps the params of the first. The dot cannot occur in an app
 * param or in a component input name, so a list param cannot collide with them.
 */
export const LIST_URL_KEYS = [
  'users',
  'roles',
  'resources',
  'flags',
  'subs',
  'invoices'
] as const;

export type ListUrlKey = (typeof LIST_URL_KEYS)[number];

/** What the URL holds for one list. The cursor is never in it. */
export type ListUrlState<S extends ListQuerySpec> = {
  filters: Partial<ListFilters<S>>;
  sortBy: string;
  sortOrder: SortOrder;
};

/** The URL param name of `param` in the list `key`. */
export function listUrlParam(key: ListUrlKey, param: string): string {
  return `${key}.${param}`;
}

function filterDefinitions(spec: ListQuerySpec) {
  return { ...spec.filters, ...spec.params };
}

/**
 * Reads the state of one list from the URL. The URL is untrusted: a value
 * that the server would reject (an unknown sort column, a wrong kind, a `q`
 * over the length cap) or a repeated param is dropped, so a stale or edited
 * link still opens the list instead of failing with a 400 on every load.
 */
export function readListUrl<S extends ListQuerySpec>(
  params: ParamMap,
  key: ListUrlKey,
  spec: S
): ListUrlState<S> {
  const single = (param: string): string | undefined => {
    const values = params.getAll(listUrlParam(key, param));
    return values.length === 1 ? values[0] : undefined;
  };
  const parsed = (raw: string | undefined, read: (raw: string) => unknown) =>
    raw === undefined ? undefined : read(raw);

  const filters: Record<string, unknown> = {};
  if (spec.search.length > 0) {
    const q = parsed(single('q'), parseListSearch);
    if (q !== undefined) filters['q'] = q;
  }
  for (const [name, definition] of Object.entries(filterDefinitions(spec))) {
    const value = parsed(single(name), (raw) =>
      parseListParam(definition, raw)
    );
    if (value !== undefined) filters[name] = value;
  }

  const sortBy = single('sortBy');
  const sortOrder = single('sortOrder');
  return {
    // Each value was parsed by the parser of the kind that `spec` gives it.
    filters: filters as Partial<ListFilters<S>>,
    sortBy:
      sortBy !== undefined && spec.sort.includes(sortBy)
        ? sortBy
        : DEFAULT_SORT_BY,
    sortOrder:
      sortOrder === 'asc' || sortOrder === 'desc'
        ? sortOrder
        : DEFAULT_SORT_ORDER
  };
}

/**
 * The URL params of one list in their canonical form: every param of the list
 * is present, and a param that holds a default (the default sort, an empty or
 * unset filter) is `null`, so a `merge` navigation removes it. Two equal states
 * give equal params.
 */
export function listUrlParams<S extends ListQuerySpec>(
  key: ListUrlKey,
  spec: S,
  state: ListUrlState<S>
): Record<string, string | null> {
  const values: Readonly<Record<string, unknown>> = state.filters;
  const names = [
    ...(spec.search.length > 0 ? ['q'] : []),
    ...Object.keys(filterDefinitions(spec))
  ];
  const params: Record<string, string | null> = {};
  for (const name of names) {
    const value = values[name];
    params[listUrlParam(key, name)] = isActiveFilterValue(value)
      ? formatListParam(value)
      : null;
  }
  params[listUrlParam(key, 'sortBy')] =
    state.sortBy === DEFAULT_SORT_BY ? null : state.sortBy;
  params[listUrlParam(key, 'sortOrder')] =
    state.sortOrder === DEFAULT_SORT_ORDER ? null : state.sortOrder;
  return params;
}

/**
 * True when the params of the list `key` in the URL are exactly `canonical`.
 * False for an unknown or invalid param, a repeated one, or a default written
 * out.
 */
export function isListUrlCanonical(
  params: ParamMap,
  key: ListUrlKey,
  canonical: Readonly<Record<string, string | null>>
): boolean {
  const prefix = listUrlParam(key, '');
  const own = params.keys.filter((name) => name.startsWith(prefix));
  const written = Object.entries(canonical).filter(
    ([, value]) => value !== null
  );
  return (
    own.length === written.length &&
    written.every(([name, value]) => {
      const values = params.getAll(name);
      return values.length === 1 && values[0] === value;
    })
  );
}
