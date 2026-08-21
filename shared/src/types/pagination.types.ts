export type SortOrder = 'asc' | 'desc';

export type CursorPaginationMeta = {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
};

export type CursorPaginatedResponse<T> = {
  data: T[];
  meta: CursorPaginationMeta;
};
