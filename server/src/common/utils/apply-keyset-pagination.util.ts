import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { decodeCursor, encodeCursor } from './cursor.util';

export interface KeysetPaginationOptions {
  cursor?: string;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  sortColumnMap: Record<string, string>;
  idColumn: string;
}

export interface KeysetPaginationResult<T> {
  data: T[];
  nextCursor: string | null;
}

export async function applyKeysetPagination<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  options: KeysetPaginationOptions
): Promise<KeysetPaginationResult<T>> {
  const { cursor, limit, sortBy, sortOrder, sortColumnMap, idColumn } = options;
  const sortColumn = sortColumnMap[sortBy] ?? Object.values(sortColumnMap)[0];
  const direction = sortOrder.toUpperCase() as 'ASC' | 'DESC';

  if (cursor) {
    const { sortValue, id } = decodeCursor(cursor);
    const op = sortOrder === 'desc' ? '<' : '>';

    qb.andWhere(
      `(${sortColumn}, ${idColumn}) ${op} (:cursorSortValue, :cursorId)`,
      { cursorSortValue: sortValue, cursorId: id }
    );
  }

  qb.orderBy(sortColumn, direction).addOrderBy(idColumn, direction);
  qb.take(limit + 1);

  const results = await qb.getMany();
  const hasMore = results.length > limit;

  if (hasMore) {
    results.pop();
  }

  const lastItem = results[results.length - 1] as
    | (T & Record<string, unknown>)
    | undefined;

  const sortByField = sortBy;
  const nextCursor =
    hasMore && lastItem
      ? encodeCursor({
          sortValue:
            (lastItem[sortByField] as string | number | boolean) ?? null,
          id: lastItem['id'] as string
        })
      : null;

  return { data: results, nextCursor };
}
