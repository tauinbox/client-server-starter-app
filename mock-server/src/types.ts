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
  locale: string;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  tokenRevokedAt: string | null;
  pendingEmail: string | null;
  pendingEmailToken: string | null;
  pendingEmailExpiresAt: string | null;
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

export interface MockFeatureFlag {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  environments: string[];
  public: boolean;
  version: number;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MockFeatureFlagRule {
  id: string;
  flagId: string;
  type: import('@app/shared/types').FeatureFlagRuleType;
  effect: import('@app/shared/types').FeatureFlagRuleEffect;
  payload: import('@app/shared/types').FeatureFlagRulePayload;
  createdAt: string;
  updatedAt: string;
}

export interface MockPlan {
  id: string;
  key: string;
  name: string;
  description: string | null;
  billingMode: import('@app/shared/types').BillingMode;
  interval: import('@app/shared/types').PlanInterval;
  meterKey: string | null;
  entitlements: string[];
  limits: Record<string, number> | null;
  trialDays: number;
  active: boolean;
  prices: Partial<
    Record<
      import('@app/shared/types').BillingProviderId,
      import('@app/shared/types').PlanPrice
    >
  >;
  createdAt: string;
  updatedAt: string;
}

export interface MockCustomer {
  id: string;
  userId: string;
  provider: import('@app/shared/types').BillingProviderId;
  providerOverride: import('@app/shared/types').BillingProviderId | null;
  country: string;
  currency: string;
  defaultPaymentMethodId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MockSubscription {
  id: string;
  customerId: string;
  planKey: string;
  provider: import('@app/shared/types').BillingProviderId;
  billingMode: import('@app/shared/types').BillingMode;
  status: import('@app/shared/types').SubscriptionStatus;
  lifecycleOwner: 'provider' | 'self';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
  paymentMethodId: string | null;
  providerSubscriptionId: string | null;
  /**
   * Internal dunning counter for the /__control renewal simulation — mirrors
   * the server's @Exclude'd column and is never serialized on the wire.
   */
  dunningAttempts?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MockInvoice {
  id: string;
  customerId: string;
  subscriptionId: string | null;
  provider: import('@app/shared/types').BillingProviderId;
  providerInvoiceRef: string;
  amountMinor: number;
  currency: string;
  status: import('@app/shared/types').InvoiceStatus;
  billingMode: import('@app/shared/types').BillingMode;
  kind: import('@app/shared/types').InvoiceKind;
  productId: string | null;
  periodStart: string;
  periodEnd: string;
  paidAt: string | null;
  receiptRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MockPaymentMethod {
  id: string;
  customerId: string;
  provider: import('@app/shared/types').BillingProviderId;
  providerMethodRef: string;
  brand: string;
  last4: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MockUsageRecord {
  id: string;
  customerId: string;
  subscriptionId: string;
  meterKey: string;
  quantity: number;
  occurredAt: string;
  // Idempotency anchor (server: unique column). Never serialized to the wire.
  idempotencyKey: string;
  recordedAt: string;
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
  pendingEmailTokens: Map<string, string>; // token -> userId
  resources: Map<string, MockResource>;
  actions: Map<string, MockAction>;
  roles: Map<string, MockRole>;
  permissions: Map<string, MockPermission>;
  rolePermissions: MockRolePermission[];
  auditLogs: MockAuditLog[];
  featureFlags: Map<string, MockFeatureFlag>;
  featureFlagRules: MockFeatureFlagRule[];
  // Billing plan catalog — mirrors the server's plan seeder. The `usage` plan is
  // seeded inactive (hidden from GET /billing/plans until the usage subsystem).
  plans: Map<string, MockPlan>;
  // Billing customers/subscriptions/invoices/payment methods — created on demand
  // by checkout / region changes, mirroring the server's per-user scoping.
  billingCustomers: Map<string, MockCustomer>;
  billingSubscriptions: Map<string, MockSubscription>;
  billingInvoices: Map<string, MockInvoice>;
  billingPaymentMethods: Map<string, MockPaymentMethod>;
  billingUsageRecords: Map<string, MockUsageRecord>;
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
