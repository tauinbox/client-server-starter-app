export const ALLOWED_USER_SORT_COLUMNS = [
  'email',
  'firstName',
  'lastName',
  'isActive',
  'createdAt'
] as const;

export type UserSortColumn = (typeof ALLOWED_USER_SORT_COLUMNS)[number];
