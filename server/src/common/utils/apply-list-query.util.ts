import { Brackets } from 'typeorm';
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import type {
  ListFilterKind,
  ListFilterValueMap,
  ListQuery,
  ListQuerySpec,
  ListSortColumn
} from '@app/shared/types';
import { CursorPaginatedResponseDto, type ListCursorQuery } from '../dtos';
import { applyKeysetPagination } from './apply-keyset-pagination.util';
import { escapeLikePattern } from './escape-like';

/**
 * The SQL expression behind each searchable field and each filter of a list.
 * The keys come from the shared definition, so a field added there fails to
 * compile here until it has a column.
 */
export type ListQueryColumns<S extends ListQuerySpec> = {
  search: Record<S['search'][number], string>;
  filters: Record<keyof S['filters'] & string, string>;
};

type FilterCondition<K extends ListFilterKind> = (
  column: string,
  param: string,
  value: ListFilterValueMap[K]
) => [string, ObjectLiteral];

const FILTER_CONDITIONS: { [K in ListFilterKind]: FilterCondition<K> } = {
  boolean: (column, param, value) => [
    `${column} = :${param}`,
    { [param]: value }
  ],
  contains: (column, param, value) => [
    `${column} ILIKE :${param}`,
    { [param]: `%${escapeLikePattern(value)}%` }
  ],
  uuidList: (column, param, value) => [
    `${column} IN (:...${param})`,
    { [param]: value }
  ],
  scopeIncludes: (column, param, value) => [
    `(cardinality(${column}) = 0 OR :${param} = ANY(${column}))`,
    { [param]: value }
  ],
  isSet: (column, _param, value) => [
    value ? `${column} IS NOT NULL` : `${column} IS NULL`,
    {}
  ],
  inFuture: (column, _param, value) => [
    value ? `${column} > now()` : `(${column} IS NULL OR ${column} <= now())`,
    {}
  ]
};

function filterCondition<K extends ListFilterKind>(
  kind: K,
  column: string,
  param: string,
  value: unknown
): [string, ObjectLiteral] {
  // The DTO has already validated and transformed the value for its kind.
  return FILTER_CONDITIONS[kind](column, param, value as ListFilterValueMap[K]);
}

/**
 * The columns of a list for `applyList`: the search and filter columns, the
 * column behind each `sortBy` value, and the id column that breaks a tie in
 * the keyset. A sort column added to the definition fails to compile here
 * until it has a column.
 */
export type ListColumns<S extends ListQuerySpec> = ListQueryColumns<S> & {
  sort: Record<ListSortColumn<S>, string>;
  id: string;
};

/**
 * ANDs the search and the filters of `query` onto `qb`. Call it after the
 * ability filter and before `applyKeysetPagination`: every condition is an
 * `andWhere`, so it can only narrow what the ability already allows, and the
 * keyset pages stay complete.
 */
export function applyListQuery<
  T extends ObjectLiteral,
  S extends ListQuerySpec
>(
  qb: SelectQueryBuilder<T>,
  spec: S,
  columns: ListQueryColumns<S>,
  query: ListQuery<S>
): void {
  const searchColumns: Readonly<Record<string, string>> = columns.search;
  const filterColumns: Readonly<Record<string, string>> = columns.filters;
  const values: Readonly<Record<string, unknown>> = query;

  if (query.q) {
    const pattern = `%${escapeLikePattern(query.q)}%`;
    qb.andWhere(
      new Brackets((sb) => {
        for (const field of spec.search) {
          sb.orWhere(`${searchColumns[field]} ILIKE :listSearch`, {
            listSearch: pattern
          });
        }
      })
    );
  }

  for (const [name, definition] of Object.entries(spec.filters)) {
    const value = values[name];
    // An empty text filter is unset, like an empty `q`: `ILIKE '%%'` would
    // still drop the rows whose column is NULL.
    if (value === undefined || value === '') continue;
    const [condition, parameters] = filterCondition(
      definition.kind,
      filterColumns[name],
      `listFilter_${name}`,
      value
    );
    qb.andWhere(condition, parameters);
  }
}

/**
 * One page of a list: the search and filters of `query`, then the keyset page
 * that `query` asks for. Add the ability filter and every condition of the
 * list's own `params` to `qb` before the call.
 */
export async function applyList<
  T extends ObjectLiteral,
  S extends ListQuerySpec
>(
  qb: SelectQueryBuilder<T>,
  spec: S,
  columns: ListColumns<S>,
  query: ListCursorQuery<S>
): Promise<CursorPaginatedResponseDto<T>> {
  applyListQuery(qb, spec, columns, query);
  const { cursor, limit, sortBy, sortOrder } = query;
  const { data, nextCursor } = await applyKeysetPagination(qb, {
    cursor,
    limit,
    sortBy,
    sortOrder,
    sortColumnMap: columns.sort,
    idColumn: columns.id
  });
  return new CursorPaginatedResponseDto(data, nextCursor, limit);
}
