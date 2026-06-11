import type {
  InvoiceResponse,
  SubscriptionResponse,
  SubscriptionStatus,
  UsageResponse
} from '@app/shared/types';
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
  // Replaces a role's permission set with `permissionIds` (empty to revoke all)
  // and pushes a `permissions_updated` SSE event to every connected holder of
  // that role — mirrors the server's RolePermissionsChangedEvent fan-out (no
  // token revocation). Use to verify that a role-permission change refreshes a
  // holder's abilities live, without a reload.
  changeRolePermissions(
    roleName: string,
    permissionIds: string[]
  ): Promise<void>;
  // Heavy hammer: deletes ALL refresh tokens for the user, sets
  // tokenRevokedAt, optionally swaps roles, and pushes a `permissions_updated`
  // SSE event. Use when testing forced-logout semantics (mirrors the server's
  // UserRoleChangedListener exactly).
  revokeUserSessions(userId: string, newRoles?: string[]): Promise<void>;
  // Toggles captcha enablement and resets the per-IP attempt tracker. Pass
  // `siteKey: null` (or omit) to use the public Turnstile test site key
  // (1x00000000000000000000AA), which always passes the visible challenge.
  setCaptcha(enabled: boolean, siteKey?: string | null): Promise<void>;
  // Simulates a successful checkout + provider webhook for billing E2E: brings
  // the user's subscription to `status` (default 'active') on `planKey` (default
  // 'pro'), attaching a default payment method and a paid invoice. The real flow
  // redirects to an external hosted-checkout page Playwright can't visit.
  activateBillingSubscription(args: {
    userId: string;
    planKey?: string;
    status?: SubscriptionStatus;
  }): Promise<SubscriptionResponse>;
  // Seeds a metered-usage record on the customer's subscription (defaults:
  // meterKey 'api_calls', quantity 1, occurredAt now) so usage views and
  // rating have data without going through the admin ingest endpoint.
  seedBillingUsage(args: {
    customerId: string;
    meterKey?: string;
    quantity?: number;
    occurredAt?: string;
    subscriptionId?: string;
    idempotencyKey?: string;
  }): Promise<UsageResponse>;
  // Simulates the provider's paid webhook for a one-time purchase opened via
  // POST /billing/purchase: settles the pending session (by sessionRef, or
  // the latest one for userId) into a paid `one_time` invoice plus the sku's
  // entitlement grant. Returns the settled invoice.
  completeBillingPurchase(args: {
    userId?: string;
    sessionRef?: string;
  }): Promise<InvoiceResponse>;
};
