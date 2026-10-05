// Same rules as the other keyset whitelists - see the header of
// `sort-columns.constants.ts`: NOT NULL only, and no precision the cursor
// cannot carry.
export const ALLOWED_USER_SORT_COLUMNS = [
  'email',
  'firstName',
  'lastName',
  'isActive',
  'createdAt'
] as const;

export type UserSortColumn = (typeof ALLOWED_USER_SORT_COLUMNS)[number];

// Application caps, not column limits: the columns are varchar with no length.
export const MAX_EMAIL_LENGTH = 255;
export const MAX_NAME_LENGTH = 255;
