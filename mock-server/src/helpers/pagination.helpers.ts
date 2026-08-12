import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER,
  MAX_PAGE_SIZE
} from '@app/shared/constants/pagination.constants';

export interface PaginationQuery {
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

const PAGINATION_KEYS = ['page', 'limit', 'sortBy', 'sortOrder'];

function integerErrors(
  name: string,
  raw: unknown,
  max?: number
): string[] | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return [`${name} must be an integer number`];
  if (value < 1) return [`${name} must not be less than 1`];
  if (max !== undefined && value > max) {
    return [`${name} must not be greater than ${max}`];
  }
  return null;
}

/**
 * Mirrors `PaginationQueryDto` under the server's global ValidationPipe
 * (`transform` + `whitelist` + `forbidNonWhitelisted`): an out-of-range or
 * non-integer `page`/`limit` is a 400 rather than a silent clamp, an unknown
 * query param is a 400, and `sortBy` is left to the handler's own whitelist
 * because the base DTO puts no `@IsIn` on it.
 */
export function paginationQueryErrors(
  query: Record<string, unknown>
): string[] {
  const errors: string[] = [];

  for (const key of Object.keys(query)) {
    if (!PAGINATION_KEYS.includes(key)) {
      errors.push(`property ${key} should not exist`);
    }
  }

  errors.push(...(integerErrors('page', query['page']) ?? []));
  errors.push(...(integerErrors('limit', query['limit'], MAX_PAGE_SIZE) ?? []));

  const sortOrder = query['sortOrder'];
  if (sortOrder !== undefined && sortOrder !== 'asc' && sortOrder !== 'desc') {
    errors.push('sortOrder must be one of the following values: asc, desc');
  }

  return errors;
}

/** Call only after `paginationQueryErrors` has returned no errors. */
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

export interface PaginatedBody<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
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
