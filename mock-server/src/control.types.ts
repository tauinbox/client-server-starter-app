import type {
  MockPermission,
  MockRole,
  MockRolePermission,
  MockUser,
  OAuthAccount,
  State
} from './types';

// Auto-tracks State shape. When State gains a new field, StateSnapshot gains
// it too (as unknown), and buildStateSnapshot in control.routes.ts will fail
// to compile until it covers the new field.
export type StateSnapshot = { readonly [K in keyof State]: unknown };

export type TokensSnapshot = {
  emailVerificationTokens: Record<string, string>;
  passwordResetTokens: Record<string, string>;
};

// Single source of truth for the __control API contract.
// When adding a new /__control route:
//   1. Add its method here
//   2. TypeScript will error in base.fixture.ts until the fixture implements it
export type ControlApi = {
  getState(): Promise<StateSnapshot>;
  getTokens(): Promise<TokensSnapshot>;
  seedUsers(users: MockUser[]): Promise<void>;
  seedOAuthAccounts(userId: string, accounts: OAuthAccount[]): Promise<void>;
  seedRoles(roles: MockRole[]): Promise<void>;
  seedPermissions(permissions: MockPermission[]): Promise<void>;
  seedRolePermissions(rolePermissions: MockRolePermission[]): Promise<void>;
  // Sets user.tokenRevokedAt = now so existing access tokens fail authentication
  // on the next call. Refresh tokens stay valid — interceptor can recover.
  invalidateAccessTokens(userId: string): Promise<void>;
  // Mutates user.roles to `newRoles` (defaults to []) and pushes a
  // `permissions_updated` SSE event. Tokens are NOT revoked, so the client
  // session continues; the next /auth/permissions fetch returns the updated
  // (possibly empty) ability. Use to verify live RBAC reactivity on the
  // client (sidenav admin link disappearing, AdminPanelComponent redirecting
  // to /forbidden).
  changeUserRoles(userId: string, newRoles: string[]): Promise<void>;
  // Heavy hammer: deletes ALL refresh tokens for the user, sets
  // tokenRevokedAt, optionally swaps roles, and pushes a `permissions_updated`
  // SSE event. Use when testing forced-logout semantics (mirrors the server's
  // UserRoleChangedListener exactly).
  revokeUserSessions(userId: string, newRoles?: string[]): Promise<void>;
};
