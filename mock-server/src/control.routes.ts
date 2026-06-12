import { randomUUID } from 'crypto';
import { Router } from 'express';
import {
  addOAuthAccounts,
  getState,
  resetState,
  toInvoiceResponse,
  toSubscriptionResponse,
  toUsageResponse,
  toUserResponse
} from './state';
import type { StateSnapshot } from './control.types';
import type {
  MockCustomer,
  MockCustomerGrant,
  MockInvoice,
  MockPaymentMethod,
  MockPermission,
  MockRole,
  MockRolePermission,
  MockSubscription,
  MockUsageRecord,
  MockUser,
  OAuthAccount,
  State
} from './types';
import type { BillingProviderId } from '@app/shared/types';
import type { NotificationEvent } from '@app/shared/types';
import { pushToAll, pushToUser } from './sse-hub';
import { notifyRoleHolders } from './middleware/roles.middleware';

const router = Router();

// StateSnapshot is a mapped type { [K in keyof State]: unknown }, so
// TypeScript will error here whenever State gains a new field that is not
// yet returned by this function.
function buildStateSnapshot(state: State): StateSnapshot {
  return {
    users: Array.from(state.users.values()).map(toUserResponse),
    oauthAccounts: Object.fromEntries(state.oauthAccounts),
    refreshTokens: state.refreshTokens.size,
    revokedRefreshTokens: state.revokedRefreshTokens.size,
    emailVerificationTokens: state.emailVerificationTokens.size,
    passwordResetTokens: state.passwordResetTokens.size,
    pendingEmailTokens: state.pendingEmailTokens.size,
    resources: Array.from(state.resources.values()),
    actions: Array.from(state.actions.values()),
    roles: Array.from(state.roles.values()),
    permissions: Array.from(state.permissions.values()),
    rolePermissions: state.rolePermissions,
    auditLogs: state.auditLogs,
    captchaConfig: state.captchaConfig,
    captchaAttempts: state.captchaAttempts.size,
    featureFlags: Array.from(state.featureFlags.values()),
    featureFlagRules: state.featureFlagRules,
    plans: Array.from(state.plans.values()),
    billingProducts: Array.from(state.billingProducts.values()),
    billingCustomers: Array.from(state.billingCustomers.values()),
    billingSubscriptions: Array.from(state.billingSubscriptions.values()),
    billingInvoices: Array.from(state.billingInvoices.values()),
    billingPaymentMethods: Array.from(state.billingPaymentMethods.values()),
    billingUsageRecords: Array.from(state.billingUsageRecords.values()).map(
      toUsageResponse
    ),
    billingCustomerGrants: Array.from(state.billingCustomerGrants.values()),
    billingPurchaseSessions: Array.from(state.billingPurchaseSessions.values()),
    billingCreditBalances: Array.from(state.billingCreditBalances.values())
  };
}

// POST /__control/reset
router.post('/reset', (_req, res) => {
  resetState();
  res.json({ message: 'State reset to seed data' });
});

// GET /__control/state
router.get('/state', (_req, res) => {
  res.json(buildStateSnapshot(getState()));
});

// POST /__control/users — add or override users
router.post('/users', (req, res) => {
  const users: MockUser[] = req.body;
  if (!Array.isArray(users)) {
    res.status(400).json({ message: 'Body must be an array of users' });
    return;
  }

  const state = getState();
  for (const user of users) {
    state.users.set(user.id, user);
  }

  res.json({ message: `Added/updated ${users.length} user(s)` });
});

// GET /__control/tokens — get all verification and reset tokens (for E2E)
router.get('/tokens', (_req, res) => {
  const state = getState();
  res.json({
    emailVerificationTokens: Object.fromEntries(state.emailVerificationTokens),
    passwordResetTokens: Object.fromEntries(state.passwordResetTokens),
    pendingEmailTokens: Object.fromEntries(state.pendingEmailTokens)
  });
});

// POST /__control/oauth-accounts — add OAuth accounts for a user
router.post('/oauth-accounts', (req, res) => {
  const { userId, accounts }: { userId: string; accounts: OAuthAccount[] } =
    req.body;

  if (!userId || !Array.isArray(accounts)) {
    res
      .status(400)
      .json({ message: 'Body must have userId and accounts array' });
    return;
  }

  addOAuthAccounts(userId, accounts);
  res.json({
    message: `Added ${accounts.length} OAuth account(s) for user ${userId}`
  });
});

// POST /__control/roles — add or override roles
router.post('/roles', (req, res) => {
  const roles: MockRole[] = req.body;
  if (!Array.isArray(roles)) {
    res.status(400).json({ message: 'Body must be an array of roles' });
    return;
  }

  const state = getState();
  for (const role of roles) {
    state.roles.set(role.id, role);
  }

  res.json({ message: `Added/updated ${roles.length} role(s)` });
});

// POST /__control/permissions — add or override permissions
router.post('/permissions', (req, res) => {
  const permissions: MockPermission[] = req.body;
  if (!Array.isArray(permissions)) {
    res.status(400).json({ message: 'Body must be an array of permissions' });
    return;
  }

  const state = getState();
  for (const permission of permissions) {
    state.permissions.set(permission.id, permission);
  }

  res.json({ message: `Added/updated ${permissions.length} permission(s)` });
});

// POST /__control/role-permissions — replace all role-permission assignments
router.post('/role-permissions', (req, res) => {
  const rolePermissions: MockRolePermission[] = req.body;
  if (!Array.isArray(rolePermissions)) {
    res
      .status(400)
      .json({ message: 'Body must be an array of role-permissions' });
    return;
  }

  const state = getState();
  state.rolePermissions = rolePermissions;

  res.json({ message: `Set ${rolePermissions.length} role-permission(s)` });
});

// POST /__control/invalidate-access-tokens — set tokenRevokedAt for a user.
// Existing access tokens issued before this call become invalid (the auth
// helper compares decoded.iat to user.tokenRevokedAt). Refresh tokens are
// LEFT INTACT so the client's 401 interceptor can refresh-and-retry.
router.post('/invalidate-access-tokens', (req, res) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) {
    res.status(400).json({ message: 'userId is required' });
    return;
  }
  const state = getState();
  const user = state.users.get(userId);
  if (!user) {
    res.status(404).json({ message: 'user not found' });
    return;
  }
  user.tokenRevokedAt = new Date().toISOString();
  res.json({ message: `tokens invalidated for user ${userId}` });
});

// POST /__control/change-user-roles — mutate user.roles and push SSE without
// revoking tokens. Lets tests verify live RBAC reactivity on the client (the
// next /auth/permissions fetch reflects the new roles, but the existing
// session keeps working — no forced logout).
router.post('/change-user-roles', (req, res) => {
  const { userId, newRoles } = req.body as {
    userId?: string;
    newRoles?: string[];
  };
  if (!userId || !Array.isArray(newRoles)) {
    res.status(400).json({ message: 'userId and newRoles[] required' });
    return;
  }
  const state = getState();
  const user = state.users.get(userId);
  if (!user) {
    res.status(404).json({ message: 'user not found' });
    return;
  }
  user.roles = newRoles;
  pushToUser(userId, { type: 'permissions_updated', userId });
  res.json({ message: `roles updated for user ${userId}` });
});

// POST /__control/change-role-permissions — replace a role's permission set and
// push SSE to every holder without revoking tokens. Verifies live RBAC
// reactivity when a role's effective permissions change (gated controls
// appearing/disappearing) — distinct from change-user-roles, which mutates a
// single user's role membership.
router.post('/change-role-permissions', (req, res) => {
  const { roleName, permissionIds } = req.body as {
    roleName?: string;
    permissionIds?: string[];
  };
  if (!roleName || !Array.isArray(permissionIds)) {
    res.status(400).json({ message: 'roleName and permissionIds[] required' });
    return;
  }
  const state = getState();
  const role = Array.from(state.roles.values()).find(
    (r) => r.name === roleName
  );
  if (!role) {
    res.status(404).json({ message: 'role not found' });
    return;
  }
  state.rolePermissions = [
    ...state.rolePermissions.filter((rp) => rp.roleId !== role.id),
    ...permissionIds.map((permissionId) => ({
      id: `rp-test-${role.id}-${permissionId}`,
      roleId: role.id,
      permissionId,
      conditions: null
    }))
  ];
  notifyRoleHolders(roleName);
  res.json({ message: `permissions updated for role ${roleName}` });
});

// POST /__control/revoke-user-sessions — full simulation of the server's
// UserRoleChangedListener. Optionally swaps user.roles, deletes ALL refresh
// tokens for the user, sets tokenRevokedAt, and pushes a `permissions_updated`
// SSE event. Use to verify forced-logout semantics on role revocation.
router.post('/revoke-user-sessions', (req, res) => {
  const { userId, newRoles } = req.body as {
    userId?: string;
    newRoles?: string[];
  };
  if (!userId) {
    res.status(400).json({ message: 'userId is required' });
    return;
  }
  const state = getState();
  const user = state.users.get(userId);
  if (!user) {
    res.status(404).json({ message: 'user not found' });
    return;
  }
  if (Array.isArray(newRoles)) {
    user.roles = newRoles;
  }
  for (const [token, uid] of state.refreshTokens.entries()) {
    if (uid === userId) state.refreshTokens.delete(token);
  }
  for (const [token, uid] of state.revokedRefreshTokens.entries()) {
    if (uid === userId) state.revokedRefreshTokens.delete(token);
  }
  user.tokenRevokedAt = new Date().toISOString();
  pushToUser(userId, { type: 'permissions_updated', userId });
  res.json({ message: `sessions revoked for user ${userId}` });
});

// POST /__control/captcha — toggle captcha enablement and reset attempts.
// Used by E2E to drive the soft-trigger flow without depending on real
// Turnstile. When enabled, the client resolves the advertised site key from
// /api/v1/auth/captcha-config; mock-server accepts any non-empty token.
router.post('/captcha', (req, res) => {
  const { enabled, siteKey } = req.body as {
    enabled?: boolean;
    siteKey?: string | null;
  };
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ message: 'enabled (boolean) is required' });
    return;
  }
  const state = getState();
  state.captchaConfig = {
    enabled,
    // Default to the Turnstile public test sitekey that always passes.
    siteKey: siteKey ?? (enabled ? '1x00000000000000000000AA' : null)
  };
  state.captchaAttempts.clear();
  res.json({ message: `captcha ${enabled ? 'enabled' : 'disabled'}` });
});

// POST /__control/notify — push a test notification event (E2E helper)
router.post('/notify', (req, res) => {
  const event = req.body as NotificationEvent;
  if (!event || !event.type) {
    res.status(400).json({ message: 'Body must be a valid NotificationEvent' });
    return;
  }
  if (
    event.type === 'session_invalidated' ||
    event.type === 'permissions_updated'
  ) {
    pushToUser(event.userId, event);
  } else {
    pushToAll(event);
  }
  res.json({ ok: true });
});

// POST /__control/billing/activate-subscription — simulate a successful
// checkout + provider webhook for E2E (the real flow redirects to an external
// hosted-checkout page Playwright can't visit). Idempotently brings a user's
// subscription to an active state, attaching a default payment method and a
// paid invoice so the settings/checkout-return pages render a complete state.
router.post('/billing/activate-subscription', (req, res) => {
  const {
    userId,
    planKey = 'pro',
    status = 'active'
  } = req.body as {
    userId?: string;
    planKey?: string;
    status?: MockSubscription['status'];
  };
  if (!userId) {
    res.status(400).json({ message: 'userId is required' });
    return;
  }

  const state = getState();
  const user = state.users.get(userId);
  if (!user) {
    res.status(404).json({ message: 'user not found' });
    return;
  }

  const plan = [...state.plans.values()].find((p) => p.key === planKey);
  if (!plan) {
    res.status(404).json({ message: `plan "${planKey}" not found` });
    return;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const periodEnd = new Date(now);
  if (plan.interval === 'year') periodEnd.setFullYear(now.getFullYear() + 1);
  else periodEnd.setMonth(now.getMonth() + 1);

  const isRu = (user.locale ?? 'en').toLowerCase().startsWith('ru');
  const country = isRu ? 'RU' : 'US';
  const provider: BillingProviderId = isRu ? 'yookassa' : 'paddle';

  let customer = [...state.billingCustomers.values()].find(
    (c) => c.userId === userId
  );
  if (!customer) {
    customer = {
      id: randomUUID(),
      userId,
      provider,
      providerOverride: null,
      country,
      currency: isRu ? 'RUB' : 'USD',
      defaultPaymentMethodId: null,
      createdAt: nowIso,
      updatedAt: nowIso
    } satisfies MockCustomer;
    state.billingCustomers.set(customer.id, customer);
  }

  // Default payment method (created once).
  if (!customer.defaultPaymentMethodId) {
    const method: MockPaymentMethod = {
      id: randomUUID(),
      customerId: customer.id,
      provider: customer.provider,
      providerMethodRef: `pm_${randomUUID()}`,
      brand: 'visa',
      last4: '4242',
      isDefault: true,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    state.billingPaymentMethods.set(method.id, method);
    customer.defaultPaymentMethodId = method.id;
  }

  // Reuse the latest open subscription if present, else create one.
  const existing = [...state.billingSubscriptions.values()]
    .filter((s) => s.customerId === customer.id && s.status !== 'canceled')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  const subscription: MockSubscription = existing ?? {
    id: randomUUID(),
    customerId: customer.id,
    planKey: plan.key,
    provider: customer.provider,
    billingMode: plan.billingMode,
    status,
    lifecycleOwner: customer.provider === 'yookassa' ? 'self' : 'provider',
    currentPeriodStart: nowIso,
    currentPeriodEnd: periodEnd.toISOString(),
    cancelAtPeriodEnd: false,
    trialEnd: null,
    paymentMethodId: customer.defaultPaymentMethodId,
    providerSubscriptionId: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  subscription.planKey = plan.key;
  subscription.billingMode = plan.billingMode;
  subscription.status = status;
  subscription.paymentMethodId = customer.defaultPaymentMethodId;
  subscription.currentPeriodEnd = periodEnd.toISOString();
  subscription.updatedAt = nowIso;
  state.billingSubscriptions.set(subscription.id, subscription);

  // A paid invoice for the plan price on the resolved provider.
  const price = plan.prices[customer.provider] ?? Object.values(plan.prices)[0];
  const invoice: MockInvoice = {
    id: randomUUID(),
    customerId: customer.id,
    subscriptionId: subscription.id,
    provider: customer.provider,
    providerInvoiceRef: `in_${randomUUID()}`,
    amountMinor: price?.amountMinor ?? 0,
    currency: price?.currency ?? 'USD',
    status: 'paid',
    billingMode: plan.billingMode,
    kind: 'subscription',
    productId: null,
    periodStart: nowIso,
    periodEnd: periodEnd.toISOString(),
    paidAt: nowIso,
    receiptRef: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  state.billingInvoices.set(invoice.id, invoice);

  res.json(toSubscriptionResponse(subscription));
});

// POST /__control/billing/seed-usage — pre-seed a usage record for E2E without
// going through the admin ingest endpoint. Attaches to the customer's active
// subscription (or an explicit subscriptionId) so usage views/rating have data.
router.post('/billing/seed-usage', (req, res) => {
  const {
    customerId,
    meterKey = 'api_calls',
    quantity = 1,
    occurredAt,
    subscriptionId,
    idempotencyKey
  } = req.body as {
    customerId?: string;
    meterKey?: string;
    quantity?: number;
    occurredAt?: string;
    subscriptionId?: string;
    idempotencyKey?: string;
  };
  if (!customerId) {
    res.status(400).json({ message: 'customerId is required' });
    return;
  }

  const state = getState();
  const subId =
    subscriptionId ??
    [...state.billingSubscriptions.values()].find(
      (s) => s.customerId === customerId
    )?.id;
  if (!subId) {
    res.status(404).json({ message: 'no subscription for customer' });
    return;
  }

  const now = new Date().toISOString();
  const record: MockUsageRecord = {
    id: randomUUID(),
    customerId,
    subscriptionId: subId,
    meterKey,
    quantity,
    occurredAt: occurredAt ?? now,
    idempotencyKey: idempotencyKey ?? `seed-${randomUUID()}`,
    recordedAt: now
  };
  state.billingUsageRecords.set(record.id, record);
  res.json(toUsageResponse(record));
});

// POST /__control/billing/complete-purchase — simulate the provider's paid
// webhook for a one-time purchase opened via POST /billing/purchase (the real
// flow redirects to an external hosted-checkout page Playwright can't visit).
// Settles a pending purchase session — by explicit `sessionRef`, or the
// latest one for `userId` — exactly the way the server's webhook reducer
// would: a paid `one_time` invoice keyed by the provider payment reference,
// plus a CustomerGrant when the product is an entitlement-granting sku, plus
// a credit-balance top-up when it is a credit pack. Settling deletes the
// session, mirroring the reducer's once-per-payment idempotency.
router.post('/billing/complete-purchase', (req, res) => {
  const { userId, sessionRef } = req.body as {
    userId?: string;
    sessionRef?: string;
  };
  if (!userId && !sessionRef) {
    res.status(400).json({ message: 'userId or sessionRef is required' });
    return;
  }

  const state = getState();
  let session = sessionRef
    ? state.billingPurchaseSessions.get(sessionRef)
    : undefined;
  if (!session && userId) {
    const customer = [...state.billingCustomers.values()].find(
      (c) => c.userId === userId
    );
    session = customer
      ? [...state.billingPurchaseSessions.values()]
          .filter((s) => s.customerId === customer.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;
  }
  if (!session) {
    res.status(404).json({ message: 'pending purchase session not found' });
    return;
  }

  const nowIso = new Date().toISOString();
  const invoice: MockInvoice = {
    id: randomUUID(),
    customerId: session.customerId,
    subscriptionId: null,
    provider: session.provider,
    providerInvoiceRef: session.sessionRef,
    amountMinor: session.amountMinor,
    currency: session.currency,
    status: 'paid',
    billingMode: 'fixed',
    kind: 'one_time',
    productId: session.productId,
    periodStart: nowIso,
    periodEnd: nowIso,
    paidAt: nowIso,
    receiptRef: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  state.billingInvoices.set(invoice.id, invoice);

  const product = state.billingProducts.get(session.productId);
  if (product?.type === 'sku' && product.grant?.entitlement) {
    const grant: MockCustomerGrant = {
      id: randomUUID(),
      customerId: session.customerId,
      entitlement: product.grant.entitlement,
      sourceInvoiceId: invoice.id,
      expiresAt: product.grant.durationDays
        ? new Date(
            Date.now() + product.grant.durationDays * 86_400_000
          ).toISOString()
        : null,
      revokedAt: null,
      createdAt: nowIso
    };
    state.billingCustomerGrants.set(grant.id, grant);
  }

  // A paid credit pack tops up the prepaid balance, mirroring the server's
  // webhook reducer.
  if (product?.type === 'credits' && product.grant?.credits) {
    const balance = state.billingCreditBalances.get(session.customerId);
    if (balance) {
      balance.balanceUnits += product.grant.credits;
      balance.updatedAt = nowIso;
    } else {
      state.billingCreditBalances.set(session.customerId, {
        customerId: session.customerId,
        balanceUnits: product.grant.credits,
        updatedAt: nowIso
      });
    }
  }

  state.billingPurchaseSessions.delete(session.sessionRef);
  res.json(toInvoiceResponse(invoice));
});

// Mirrors the server's dunning policy (renewal-queue.constants).
const DUNNING_MAX_ATTEMPTS = 3;

// POST /__control/billing/advance-renewal — renewal-clock advance for E2E:
// treats the subscription's current period as due NOW and runs one scheduler
// pass on it, mirroring the server's period-close semantics. `outcome:
// 'success'` (default) charges and advances: fixed subs get a paid invoice at
// the plan price covering the NEW period; usage subs get a postpaid invoice
// covering the CLOSED period (records with occurredAt in [periodStart, now),
// overage beyond includedUnits at unitPriceMinor; zero usage → zero invoice,
// no charge). `outcome: 'failure'` simulates a declined off-session charge:
// past_due + dunning, canceling once the attempts are exhausted.
router.post('/billing/advance-renewal', (req, res) => {
  const {
    userId,
    subscriptionId,
    outcome = 'success'
  } = req.body as {
    userId?: string;
    subscriptionId?: string;
    outcome?: 'success' | 'failure';
  };
  if (outcome !== 'success' && outcome !== 'failure') {
    res.status(400).json({ message: 'outcome must be success or failure' });
    return;
  }

  const state = getState();
  let subscription = subscriptionId
    ? state.billingSubscriptions.get(subscriptionId)
    : undefined;
  if (!subscription && userId) {
    const customer = [...state.billingCustomers.values()].find(
      (c) => c.userId === userId
    );
    subscription = customer
      ? [...state.billingSubscriptions.values()]
          .filter(
            (s) =>
              s.customerId === customer.id &&
              ['trialing', 'active', 'past_due'].includes(s.status)
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;
  }
  if (!subscription) {
    res.status(404).json({ message: 'subscription not found' });
    return;
  }

  const now = new Date();
  const nowIso = now.toISOString();

  if (outcome === 'failure') {
    const attempts = (subscription.dunningAttempts ?? 0) + 1;
    subscription.dunningAttempts = attempts;
    subscription.status =
      attempts >= DUNNING_MAX_ATTEMPTS ? 'canceled' : 'past_due';
    if (subscription.status === 'canceled') {
      subscription.cancelAtPeriodEnd = false;
    }
    subscription.updatedAt = nowIso;
    res.json(toSubscriptionResponse(subscription));
    return;
  }

  const plan = [...state.plans.values()].find(
    (p) => p.key === subscription.planKey
  );
  const price = plan?.prices[subscription.provider];
  if (!plan || !price) {
    res.status(404).json({ message: 'plan or price not found' });
    return;
  }

  // Cancel-at-period-end: the boundary cancels instead of charging.
  if (subscription.cancelAtPeriodEnd) {
    subscription.status = 'canceled';
    subscription.updatedAt = nowIso;
    res.json(toSubscriptionResponse(subscription));
    return;
  }

  // The clock advance anchors the boundary at NOW: the closed period is
  // [currentPeriodStart, now) and the new one [now, now + interval).
  const closedStart = subscription.currentPeriodStart;
  const newEnd = new Date(now);
  if (plan.interval === 'year') newEnd.setFullYear(newEnd.getFullYear() + 1);
  else newEnd.setMonth(newEnd.getMonth() + 1);

  let amountMinor = price.amountMinor;
  let periodStart = nowIso;
  let periodEnd = newEnd.toISOString();
  if (subscription.billingMode === 'usage') {
    const totalUnits = [...state.billingUsageRecords.values()]
      .filter(
        (r) =>
          r.subscriptionId === subscription.id &&
          r.occurredAt >= closedStart &&
          r.occurredAt < nowIso
      )
      .reduce((sum, r) => sum + r.quantity, 0);
    const billableUnits = Math.max(0, totalUnits - (price.includedUnits ?? 0));
    // Prepaid credits offset billable units one-for-one before pricing,
    // mirroring the server's summarizeForPeriodWithCredits + spend commit: a
    // clawed-back negative balance offers nothing, and the deduction settles
    // with the postpaid invoice below.
    const balance = state.billingCreditBalances.get(subscription.customerId);
    const creditUnitsApplied = Math.min(
      Math.max(0, balance?.balanceUnits ?? 0),
      billableUnits
    );
    if (balance && creditUnitsApplied > 0) {
      balance.balanceUnits -= creditUnitsApplied;
      balance.updatedAt = nowIso;
    }
    amountMinor =
      (billableUnits - creditUnitsApplied) * (price.unitPriceMinor ?? 0);
    periodStart = closedStart;
    periodEnd = nowIso;
  }

  const invoice: MockInvoice = {
    id: randomUUID(),
    customerId: subscription.customerId,
    subscriptionId: subscription.id,
    provider: subscription.provider,
    providerInvoiceRef: `in_${randomUUID()}`,
    amountMinor,
    currency: price.currency,
    status: 'paid',
    billingMode: subscription.billingMode,
    kind: 'subscription',
    productId: null,
    periodStart,
    periodEnd,
    paidAt: nowIso,
    receiptRef: null,
    createdAt: nowIso,
    updatedAt: nowIso
  };
  state.billingInvoices.set(invoice.id, invoice);

  subscription.status = 'active';
  subscription.trialEnd = null;
  subscription.dunningAttempts = 0;
  subscription.currentPeriodStart = nowIso;
  subscription.currentPeriodEnd = newEnd.toISOString();
  subscription.updatedAt = nowIso;
  res.json(toSubscriptionResponse(subscription));
});

export default router;
