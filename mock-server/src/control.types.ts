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
};
