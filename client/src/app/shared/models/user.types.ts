import type { UserResponse, SortOrder } from '@app/shared/types';
import type { UserSortColumn } from '@app/shared/constants';

export type {
  PaginationMeta,
  PaginatedResponse,
  SortOrder
} from '@app/shared/types';
export type { UserSortColumn } from '@app/shared/constants';

// Re-export UserResponse as User for backward compatibility across client code
export type User = UserResponse;

export type UserSearch = Pick<
  Partial<User>,
  'email' | 'firstName' | 'lastName' | 'isAdmin' | 'isActive'
>;

export type CreateUser = Pick<User, 'email' | 'firstName' | 'lastName'> & {
  password: string;
};

export type UpdateUser = Pick<
  Partial<User>,
  'email' | 'firstName' | 'lastName' | 'isAdmin' | 'isActive'
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
