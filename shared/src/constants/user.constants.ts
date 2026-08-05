export const ALLOWED_USER_SORT_COLUMNS = [
  'email',
  'firstName',
  'lastName',
  'isActive',
  'createdAt'
] as const;

export type UserSortColumn = (typeof ALLOWED_USER_SORT_COLUMNS)[number];

// Cap for every string filter on the user list/search endpoints. The
// searchable columns are all varchar(255), so a longer needle cannot match
// anything - accepting it only builds a larger ILIKE pattern.
export const MAX_USER_FILTER_LENGTH = 255;
