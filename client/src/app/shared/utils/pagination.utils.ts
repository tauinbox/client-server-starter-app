import { HttpParams } from '@angular/common/http';
import { DEFAULT_PAGE_SIZE } from '@app/shared/constants/pagination.constants';

/** Page sizes offered by `mat-paginator`; all within the server's cap. */
export const PAGE_SIZE_OPTIONS = [DEFAULT_PAGE_SIZE, 25, 50, 100];

/** A page request as the server's `PaginationQueryDto` accepts it. */
export type PageRequest = {
  page?: number;
  limit?: number;
};

/**
 * Only the params the caller set are sent — an omitted `page`/`limit` lets the
 * server apply its own defaults instead of the client duplicating them.
 */
export function pageParams({ page, limit }: PageRequest): HttpParams {
  let params = new HttpParams();
  if (page !== undefined) {
    params = params.set('page', page.toString());
  }
  if (limit !== undefined) {
    params = params.set('limit', limit.toString());
  }
  return params;
}
