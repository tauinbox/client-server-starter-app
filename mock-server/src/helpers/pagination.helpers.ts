import {
  DEFAULT_CURSOR_PAGE_SIZE,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
  MAX_PAGE_SIZE
} from '@app/shared/constants';
import type { SortOrder } from '@app/shared/types';
import { encodeCursor, parseCursor } from '@app/shared/utils/cursor';

export interface PaginationQuery {
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: SortOrder;
}

export interface CursorQuery {
  cursor?: string;
  limit: number;
  sortBy: string;
  sortOrder: SortOrder;
}

const OFFSET_KEYS = ['page', 'limit', 'sortBy', 'sortOrder'];
const CURSOR_KEYS = ['cursor', 'limit', 'sortBy', 'sortOrder'];

function integerErrors(name: string, raw: unknown, max: number): string[] {
  if (raw === undefined) return [];
  const value = Number(raw);
  if (!Number.isInteger(value)) return [`${name} must be an integer number`];
  if (value < 1) return [`${name} must not be less than 1`];
  if (value > max) return [`${name} must not be greater than ${max}`];
  return [];
}

function unknownKeyErrors(
  query: Record<string, unknown>,
  allowed: readonly string[],
  extraAllowed: readonly string[]
): string[] {
  return Object.keys(query)
    .filter((key) => !allowed.includes(key) && !extraAllowed.includes(key))
    .map((key) => `property ${key} should not exist`);
}

function sortOrderErrors(raw: unknown): string[] {
  if (raw === undefined || raw === 'asc' || raw === 'desc') return [];
  return ['sortOrder must be one of the following values: asc, desc'];
}

function sortByErrors(raw: unknown, allowed: readonly string[]): string[] {
  if (raw === undefined || allowed.length === 0) return [];
  if (allowed.includes(String(raw))) return [];
  return [`sortBy must be one of the following values: ${allowed.join(', ')}`];
}

/**
 * Mirrors `PaginationQueryDto` under the server's global ValidationPipe
 * (`transform` + `whitelist` + `forbidNonWhitelisted`): an out-of-range or
 * non-integer `page`/`limit` is a 400, never a silent clamp, and an unknown
 * query param is a 400.
 *
 * `extraAllowed` lists the params a route legitimately carries on top of the
 * shared ones (the user list's filters), so they are not reported as unknown.
 */
export function paginationQueryErrors(
  query: Record<string, unknown>,
  options: {
    extraAllowed?: readonly string[];
    sortColumns?: readonly string[];
  } = {}
): string[] {
  const { extraAllowed = [], sortColumns = [] } = options;
  return [
    ...unknownKeyErrors(query, OFFSET_KEYS, extraAllowed),
    ...integerErrors('page', query['page'], Number.MAX_SAFE_INTEGER),
    ...integerErrors('limit', query['limit'], MAX_PAGE_SIZE),
    ...sortByErrors(query['sortBy'], sortColumns),
    ...sortOrderErrors(query['sortOrder'])
  ];
}

/** Same contract as `paginationQueryErrors`, for `CursorPaginationQueryDto`. */
export function cursorQueryErrors(
  query: Record<string, unknown>,
  options: {
    extraAllowed?: readonly string[];
    sortColumns?: readonly string[];
  } = {}
): string[] {
  const { extraAllowed = [], sortColumns = [] } = options;
  return [
    ...unknownKeyErrors(query, CURSOR_KEYS, extraAllowed),
    ...integerErrors('limit', query['limit'], MAX_PAGE_SIZE),
    ...sortByErrors(query['sortBy'], sortColumns),
    ...sortOrderErrors(query['sortOrder'])
  ];
}

/** Call only after the matching `*QueryErrors` returned no errors. */
export function parsePaginationQuery(
  query: Record<string, unknown>
): PaginationQuery {
  return {
    page: query['page'] === undefined ? DEFAULT_PAGE : Number(query['page']),
    limit:
      query['limit'] === undefined ? DEFAULT_PAGE_SIZE : Number(query['limit']),
    sortBy:
      query['sortBy'] === undefined ? DEFAULT_SORT_BY : String(query['sortBy']),
    sortOrder: query['sortOrder'] === 'asc' ? 'asc' : DEFAULT_SORT_ORDER
  };
}

export function parseCursorQuery(query: Record<string, unknown>): CursorQuery {
  return {
    cursor: query['cursor'] ? String(query['cursor']) : undefined,
    limit:
      query['limit'] === undefined
        ? DEFAULT_CURSOR_PAGE_SIZE
        : Number(query['limit']),
    sortBy:
      query['sortBy'] === undefined ? DEFAULT_SORT_BY : String(query['sortBy']),
    sortOrder: query['sortOrder'] === 'asc' ? 'asc' : DEFAULT_SORT_ORDER
  };
}

export interface PaginatedBody<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface CursorPaginatedBody<T> {
  data: T[];
  meta: { nextCursor: string | null; hasMore: boolean; limit: number };
}

/** Slices an already-sorted list into the requested page. */
export function paginate<T>(
  items: T[],
  { page, limit }: PaginationQuery
): PaginatedBody<T> {
  const start = (page - 1) * limit;
  return {
    data: items.slice(start, start + limit),
    meta: {
      page,
      limit,
      total: items.length,
      totalPages: Math.ceil(items.length / limit)
    }
  };
}

/** The cursor payload only carries primitives; a Date is sent as its ISO text. */
function toCursorValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return String(value);
}

export function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b);
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b);
  }
  return String(a).localeCompare(String(b));
}

/**
 * Mirrors `applyKeysetPagination`: sorts on `(sortBy, id)`, walks past the
 * cursor row and returns one page plus the cursor for the next one. Reading
 * one row beyond the page is what decides `hasMore`, exactly as the server's
 * `take(limit + 1)` does.
 */
function readField(item: object, key: string): unknown {
  return Reflect.get(item, key);
}

export function cursorPaginate<T extends { id: string }>(
  items: T[],
  { cursor, limit, sortBy, sortOrder }: CursorQuery
): CursorPaginatedBody<T> {
  const direction = sortOrder === 'asc' ? 1 : -1;

  const sorted = [...items].sort((a, b) => {
    const cmp =
      compareValues(readField(a, sortBy), readField(b, sortBy)) * direction;
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id) * direction;
  });

  let startIndex = 0;
  if (cursor) {
    const decoded = parseCursor(cursor);
    if (decoded) {
      startIndex = sorted.findIndex((item) => {
        const cmp =
          compareValues(readField(item, sortBy), decoded.sortValue) * direction;
        if (cmp > 0) return true;
        return cmp === 0 && item.id.localeCompare(decoded.id) * direction > 0;
      });
      if (startIndex === -1) startIndex = sorted.length;
    }
  }

  const slice = sorted.slice(startIndex, startIndex + limit + 1);
  const hasMore = slice.length > limit;
  const data = hasMore ? slice.slice(0, limit) : slice;
  const lastItem = data[data.length - 1];

  return {
    data,
    meta: {
      nextCursor:
        hasMore && lastItem
          ? encodeCursor({
              sortValue: toCursorValue(readField(lastItem, sortBy)),
              id: lastItem.id
            })
          : null,
      hasMore,
      limit
    }
  };
}
