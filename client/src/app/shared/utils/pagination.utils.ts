import { HttpParams } from '@angular/common/http';
import {
  DEFAULT_CURSOR_PAGE_SIZE,
  DEFAULT_SORT_BY,
  DEFAULT_SORT_ORDER
} from '@app/shared/constants';
import type { SortOrder } from '@app/shared/types';

/**
 * One page request against a cursor-paginated list endpoint. `cursor` is the
 * opaque `meta.nextCursor` of the previous response; omitting it asks for the
 * first page.
 */
export type CursorPageRequest = {
  cursor?: string | null;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
};

export const CURSOR_PAGE_SIZE = DEFAULT_CURSOR_PAGE_SIZE;

/** Idle time before a typed search term reaches the server. */
export const LIST_SEARCH_DEBOUNCE_MS = 350;

/**
 * Only the params the caller set are sent, so an omitted value keeps the
 * server's own default rather than the client duplicating it. A null cursor is
 * treated as "first page" and left off entirely.
 */
export function cursorParams({
  cursor,
  limit,
  sortBy,
  sortOrder
}: CursorPageRequest): HttpParams {
  let params = new HttpParams();
  if (cursor) {
    params = params.set('cursor', cursor);
  }
  if (limit !== undefined) {
    params = params.set('limit', limit.toString());
  }
  if (sortBy !== undefined && sortBy !== DEFAULT_SORT_BY) {
    params = params.set('sortBy', sortBy);
  }
  if (sortOrder !== undefined && sortOrder !== DEFAULT_SORT_ORDER) {
    params = params.set('sortOrder', sortOrder);
  }
  return params;
}

/** A filter value that narrows a list: an empty string or array does not. */
export function isActiveFilterValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  return !Array.isArray(value) || value.length > 0;
}

/**
 * Adds the search and filter params of a list query to `params`. A value that
 * narrows nothing is left off, so the server applies no filter for it; a list
 * is sent comma-separated, the form the server splits.
 */
export function listQueryParams(
  params: HttpParams,
  query: Readonly<Record<string, unknown>>
): HttpParams {
  let next = params;
  for (const [name, value] of Object.entries(query)) {
    if (!isActiveFilterValue(value)) continue;
    next = next.set(
      name,
      Array.isArray(value) ? value.join(',') : String(value)
    );
  }
  return next;
}
