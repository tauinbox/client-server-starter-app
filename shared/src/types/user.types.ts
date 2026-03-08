import { RoleResponse } from './role.types';

export type UserResponse = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  roles: RoleResponse[];
  isEmailVerified: boolean;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type OAuthAccountResponse = {
  provider: string;
  providerId: string;
  createdAt: string;
};
