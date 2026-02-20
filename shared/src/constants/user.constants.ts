export const ALLOWED_USER_SORT_COLUMNS = [
  'email',
  'firstName',
  'lastName',
  'isActive',
  'isAdmin',
  'createdAt'
] as const;

export type UserSortColumn = (typeof ALLOWED_USER_SORT_COLUMNS)[number];
