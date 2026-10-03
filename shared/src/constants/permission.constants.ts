export const SYSTEM_ROLES = {
  ADMIN: 'admin',
  USER: 'user'
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

export const ROLE_NAME_MAX_LENGTH = 100;
