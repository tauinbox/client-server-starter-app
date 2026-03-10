import type { Request } from 'express';

export type {
  UserResponse,
  OAuthAccountResponse,
  TokensResponse,
  AuthResponse
} from '@app/shared/types';

export interface MockUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  isActive: boolean;
  roles: string[];
  isEmailVerified: boolean;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  tokenRevokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface OAuthAccount {
  provider: string;
  providerId: string;
  createdAt: string;
}

export interface MockResource {
  id: string;
  name: string;
  subject: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  lastSyncedAt: string;
  createdAt: string;
}

export interface MockAction {
  id: string;
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  createdAt: string;
}

export interface MockRole {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isSuper: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MockPermission {
  id: string;
  resourceId: string;
  actionId: string;
  description: string | null;
  createdAt: string;
}

export interface MockRolePermission {
  id: string;
  roleId: string;
  permissionId: string;
  conditions: import('@app/shared/types').PermissionCondition | null;
}

export interface MockAuditLog {
  id: string;
  action: string;
  actorId: string | null;
  actorEmail: string | null;
  targetId: string | null;
  targetType: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface State {
  users: Map<string, MockUser>;
  oauthAccounts: Map<string, OAuthAccount[]>;
  refreshTokens: Map<string, string>;
  emailVerificationTokens: Map<string, string>; // token -> userId
  passwordResetTokens: Map<string, string>; // token -> userId
  resources: Map<string, MockResource>;
  actions: Map<string, MockAction>;
  roles: Map<string, MockRole>;
  permissions: Map<string, MockPermission>;
  rolePermissions: MockRolePermission[];
  auditLogs: MockAuditLog[];
}

export interface AuthenticatedRequest extends Request {
  user: MockUser;
}
