import { RoleResponse, RoleAdminResponse } from './role.types';

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
 * Adds lockout state and switches roles to RoleAdminResponse so the
 * admin UI can read isSystem/isSuper.
 */
export type AdminUserResponse = Omit<UserResponse, 'roles'> & {
  roles: RoleAdminResponse[];
  lockedUntil?: string | null;
};

export type OAuthAccountResponse = {
  provider: string;
  providerId: string;
  createdAt: string;
};
