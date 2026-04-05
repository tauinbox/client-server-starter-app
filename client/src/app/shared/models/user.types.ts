import type { AdminUserResponse, SortOrder } from '@app/shared/types';
import type { UserSortColumn } from '@app/shared/constants';

export type {
  PaginationMeta,
  PaginatedResponse,
  CursorPaginationMeta,
  CursorPaginatedResponse,
  SortOrder
} from '@app/shared/types';
export type { UserSortColumn } from '@app/shared/constants';

// Admin pages need lockedUntil for the account-lock UI, so User maps to AdminUserResponse.
// Auth profile responses omit lockedUntil at runtime but the type is a safe superset.
export type User = AdminUserResponse;

export type UserSearch = Pick<
  Partial<User>,
  'email' | 'firstName' | 'lastName' | 'isActive'
>;

export type CreateUser = Pick<User, 'email' | 'firstName' | 'lastName'> & {
  password: string;
};

export type UpdateUser = Pick<
  Partial<User>,
  'email' | 'firstName' | 'lastName' | 'isActive'
> & {
  password?: string;
  unlockAccount?: boolean;
};

export type UserListParams = {
  page: number;
  limit: number;
  sortBy: UserSortColumn;
  sortOrder: SortOrder;
};

export type UserCursorListParams = {
  cursor?: string;
  limit: number;
  sortBy: UserSortColumn;
  sortOrder: SortOrder;
};
