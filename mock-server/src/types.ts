import type { Request } from 'express';

export type {
  AdminUserResponse,
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
  isOrphaned: boolean;
  isRegistered: boolean;
  allowedActionNames: string[] | null;
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

export interface CaptchaConfig {
  enabled: boolean;
  siteKey: string | null;
}

export interface CaptchaAttemptWindow {
  // Sliding-window timestamps (epoch ms) of recent attempts within the route's TTL.
  timestamps: number[];
}

export interface State {
  users: Map<string, MockUser>;
  oauthAccounts: Map<string, OAuthAccount[]>;
  refreshTokens: Map<string, string>;
  // Revoked refresh tokens — kept around to detect token reuse (OAuth 2.0 BCP).
  // If a token was rotated (moved to this map) and is presented again before
  // it would naturally expire, treat as a possible compromise: revoke all
  // sessions for the user.
  revokedRefreshTokens: Map<string, string>; // token -> userId
  emailVerificationTokens: Map<string, string>; // token -> userId
  passwordResetTokens: Map<string, string>; // token -> userId
  resources: Map<string, MockResource>;
  actions: Map<string, MockAction>;
  roles: Map<string, MockRole>;
  permissions: Map<string, MockPermission>;
  rolePermissions: MockRolePermission[];
  auditLogs: MockAuditLog[];
  // CAPTCHA — public configuration advertised via /api/v1/auth/captcha-config.
  // Default: disabled. Tests can flip via /__control/captcha to exercise the
  // soft-trigger flow without an external Turnstile dependency.
  captchaConfig: CaptchaConfig;
  // Per-route + per-IP attempt tracker for captcha soft-trigger. Keyed
  // `${routeName}:${ip}`.
  captchaAttempts: Map<string, CaptchaAttemptWindow>;
}

export interface AuthenticatedRequest extends Request {
  user: MockUser;
}
