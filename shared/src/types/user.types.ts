import { RoleResponse } from './role.types';

export type UserResponse = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  roles: RoleResponse[];
  isEmailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/**
 * Extended response used only by admin endpoints (UsersController).
 * Includes lockout state needed for the admin user-management UI.
 */
export type AdminUserResponse = UserResponse & {
  lockedUntil?: string | null;
};

export type OAuthAccountResponse = {
  provider: string;
  providerId: string;
  createdAt: string;
};
