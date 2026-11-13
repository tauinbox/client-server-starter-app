import { randomUUID } from 'crypto';
import { Router } from 'express';
import {
  addOAuthAccounts,
  findUserById,
  getState,
  rekeyUserSessions,
  resetState,
  toInvoiceResponse,
  toSubscriptionResponse,
  toUsageResponse,
  toUserResponse
} from './state';
import type { StateSnapshot } from './control.types';
import type {
  MockIssuedToken,
  MockPermission,
  MockRole,
  MockRolePermission,
  MockSubscription,
  MockUser,
  OAuthAccount,
  State
} from './types';
import {
  DEFAULT_SESSION_ABSOLUTE_MAX_MS,
  MFA_PENDING_TOKEN_EXPIRY_SECONDS
} from '@app/shared/constants';
import { OAUTH_DATA_MAX_AGE_MS, REAUTH_PROOF_MAX_AGE_MS } from './constants';
import { isStepUpOperation } from '@app/shared/utils/step-up-operation';
import { generateMfaPendingToken } from './jwt.utils';
import { pushToUser } from './sse-hub';
import {
  activateSubscription,
  settlePurchase
} from './helpers/billing-settle.helpers';
import {
  advanceRenewal,
  findRenewableSubscription,
  seedUsage,
  setProviderEnabled,
  type RenewalOutcome
} from './helpers/billing-clock.helpers';
import { consumeCredits } from './helpers/billing-metering.helpers';
import { notifyRoleHolders } from './middleware/roles.middleware';

const router = Router();

// StateSnapshot is a mapped type { [K in keyof State]: unknown }, so
// TypeScript will error here whenever State gains a new field that is not
// yet returned by this function.
function buildStateSnapshot(state: State): StateSnapshot {
  return {
    users: Array.from(state.users.values()).map(toUserResponse),
    oauthAccounts: Object.fromEntries(state.oauthAccounts),
    oauthDataTokens: state.oauthDataTokens.size,
    reauthProofs: state.reauthProofs.size,
    refreshTokens: state.refreshTokens.size,
    refreshSessions: state.refreshSessions.size,
    sessionStarts: state.sessionStarts.size,
    sessionUserAgents: state.sessionUserAgents.size,
    sessionIps: state.sessionIps.size,
    sessionLastActive: state.sessionLastActive.size,
    revokedRefreshTokens: state.revokedRefreshTokens.size,
    rotatedTo: state.rotatedTo.size,
    emailVerificationTokens: state.emailVerificationTokens.size,
    passwordResetTokens: state.passwordResetTokens.size,
    pendingEmailTokens: state.pendingEmailTokens.size,
    resources: Array.from(state.resources.values()),
    actions: Array.from(state.actions.values()),
    roles: Array.from(state.roles.values()),
    permissions: Array.from(state.permissions.values()),
    rolePermissions: state.rolePermissions,
    auditLogs: state.auditLogs,
    paddleClientConfig: state.paddleClientConfig,
    captchaConfig: state.captchaConfig,
    captchaAttempts: state.captchaAttempts.size,
    mfaChallengeFailures: state.mfaChallengeFailures.size,
    mfaStepUpFailures: state.mfaStepUpFailures.size,
    stepUpPasswordFailures: state.stepUpPasswordFailures.size,
    breachedPasswords: Array.from(state.breachedPasswords),
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
    billingCheckoutSessions: Array.from(state.billingCheckoutSessions.values()),
    billingCreditBalances: Array.from(state.billingCreditBalances.values()),
    billingWebhookEvents: Array.from(state.billingWebhookEvents.values())
  };
}

function mapTokensToUserIds(
  tokens: Map<string, MockIssuedToken>
): Record<string, string> {
  return Object.fromEntries(
    [...tokens.entries()].map(([token, issued]) => [token, issued.userId])
  );
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
    // A test seeds the fields it cares about. Anything it leaves out has to
    // land as the null the rest of the mock reads, not as undefined.
    state.users.set(user.id, {
      ...user,
      totpSecret: user.totpSecret ?? null,
      totpEnabledAt: user.totpEnabledAt ?? null,
      totpRecoveryCodes: user.totpRecoveryCodes ?? null,
      totpLastUsedStep: user.totpLastUsedStep ?? null
    });
  }

  res.json({ message: `Added/updated ${users.length} user(s)` });
});

// GET /__control/tokens — get all verification and reset tokens (for E2E)
router.get('/tokens', (_req, res) => {
  const state = getState();

  res.json({
    emailVerificationTokens: mapTokensToUserIds(state.emailVerificationTokens),
    passwordResetTokens: mapTokensToUserIds(state.passwordResetTokens),
    pendingEmailTokens: Object.fromEntries(state.pendingEmailTokens)
  });
});

// POST /__control/expire-token — move a mailed token past its deadline.
// The verification and reset tokens live for 24 hours and 30 minutes, so an
// E2E cannot wait one out. This ages the token instead of shifting the clock.
router.post('/expire-token', (req, res) => {
  const { token }: { token: string } = req.body;

  if (!token) {
    res.status(400).json({ message: 'Body must have token' });

    return;
  }

  const state = getState();
  const issued =
    state.emailVerificationTokens.get(token) ??
    state.passwordResetTokens.get(token);

  if (!issued) {
    res.status(404).json({ message: `Unknown token ${token}` });

    return;
  }

  issued.expiresAt = new Date(Date.now() - 1000).toISOString();
  res.json({ message: `Token ${token} has expired` });
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

  try {
    addOAuthAccounts(userId, accounts);
  } catch (error) {
    res.status(400).json({ message: (error as Error).message });

    return;
  }

  res.json({
    message: `Added ${accounts.length} OAuth account(s) for user ${userId}`
  });
});

// POST /__control/oauth-data — mint an `oauth_data` cookie value for a user
// `provider` names the provider the round trip went through (default google).
router.post('/oauth-data', (req, res) => {
  const { userId, provider = 'google' }: { userId: string; provider?: string } =
    req.body;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    res.status(400).json({ message: 'Body must have a known userId' });

    return;
  }

  const state = getState();
  const token = randomUUID();
  const now = Date.now();
  const expiresAt = now + OAUTH_DATA_MAX_AGE_MS;

  // The real server decides this in its provider callback, which is a Not
  // Implemented stub here. An account that carries a second factor is not
  // signed in yet, so no session is minted and the round trip carries a
  // challenge instead.
  if (user.totpEnabledAt) {
    state.oauthDataTokens.set(token, {
      userId: user.id,
      challenge: {
        mfaRequired: true,
        mfaToken: generateMfaPendingToken(user, { provider }),
        expiresIn: MFA_PENDING_TOKEN_EXPIRY_SECONDS
      },
      issuedAtMs: now,
      expiresAt
    });
    res.json({ token });

    return;
  }

  // No session yet: POST /auth/oauth/exchange issues it, as on the server.
  state.oauthDataTokens.set(token, {
    userId: user.id,
    provider,
    issuedAtMs: now,
    expiresAt
  });

  res.json({ token });
});

// POST /__control/reauth-proof — mint a step-up proof for a user The real
// server mints this at the end of a provider round trip. Both provider halves
// answer Not Implemented here, so E2E seeds the proof directly and sets the
// cookie the value belongs to.
router.post('/reauth-proof', (req, res) => {
  const { userId, operation }: { userId: string; operation?: string } =
    req.body;
  const user = userId ? findUserById(userId) : undefined;

  if (!user) {
    res.status(400).json({ message: 'Body must have a known userId' });

    return;
  }

  if (!isStepUpOperation(operation)) {
    res.status(400).json({ message: 'Body must have a known operation' });

    return;
  }

  const token = randomUUID();

  getState().reauthProofs.set(token, {
    userId: user.id,
    issuedAtMs: Date.now(),
    expiresAt: Date.now() + REAUTH_PROOF_MAX_AGE_MS,
    operation
  });

  res.json({ token });
});

// POST /__control/breached-passwords — extend the mock breach corpus
// The real server asks a public range API. The mock must not reach the
// network, so it carries a fixed sample and a test seeds any value it needs
// the server to refuse.
router.post('/breached-passwords', (req, res) => {
  const passwords: unknown = req.body;

  if (
    !Array.isArray(passwords) ||
    passwords.some((value) => typeof value !== 'string')
  ) {
    res.status(400).json({ message: 'Body must be an array of strings' });

    return;
  }

  const state = getState();

  for (const password of passwords as string[]) {
    state.breachedPasswords.add(password);
  }

  res.json({ count: state.breachedPasswords.size });
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

// POST /__control/invalidate-access-tokens — end every access token a user
// holds. The live sessions get new ids, so the session check refuses each
// token issued so far whatever second it was issued in. Refresh tokens are
// LEFT INTACT so the client's Unauthorized interceptor can refresh-and-retry.
// No `tokenRevokedAt` is written: that stamp also ends every session that
// started before it, the refresh tokens included.
router.post('/invalidate-access-tokens', (req, res) => {
  const { userId } = req.body as { userId?: string };

  if (!userId) {
    res.status(400).json({ message: 'userId is required' });

    return;
  }

  if (!getState().users.has(userId)) {
    res.status(404).json({ message: 'user not found' });

    return;
  }

  rekeyUserSessions(userId);
  res.json({ message: `tokens invalidated for user ${userId}` });
});

// POST /__control/age-session — move the start of a user's sessions back.
// The absolute session cap is 30 days, so an E2E cannot wait one out. This
// ages the session instead of shifting the clock, the way expire-token ages a
// mailed token.
router.post('/age-session', (req, res) => {
  const { userId, ageMs } = req.body as { userId?: string; ageMs?: number };

  if (!userId) {
    res.status(400).json({ message: 'userId is required' });

    return;
  }

  const state = getState();

  if (!state.users.has(userId)) {
    res.status(404).json({ message: 'user not found' });

    return;
  }

  const offset = ageMs ?? DEFAULT_SESSION_ABSOLUTE_MAX_MS;
  let aged = 0;

  for (const [token, tokenUserId] of state.refreshTokens.entries()) {
    if (tokenUserId !== userId) continue;

    const sessionId = state.refreshSessions.get(token);

    if (sessionId === undefined) continue;

    const startedAt = state.sessionStarts.get(sessionId);

    if (startedAt === undefined) continue;

    state.sessionStarts.set(sessionId, startedAt - offset);
    aged++;
  }

  res.json({ message: `Aged ${aged} session(s) of user ${userId}` });
});

// POST /__control/totp-ledger — clear the replay floor for a user.
// A code is single use, so a test that must present the one fixed code twice
// needs the wait for the next code that a real authenticator would impose.
// Clearing the floor is that wait, without a 30-second sleep in the run.
router.post('/totp-ledger', (req, res) => {
  const { userId } = req.body as { userId?: string };

  if (!userId) {
    res.status(400).json({ message: 'userId is required' });

    return;
  }

  const user = getState().users.get(userId);

  if (!user) {
    res.status(404).json({ message: 'user not found' });

    return;
  }

  user.totpLastUsedStep = null;
  res.json({ message: `totp ledger cleared for user ${userId}` });
});

// POST /__control/change-user-roles - a permission change of a live session.
// No API path does this, because a role assignment ends the sessions.
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
  pushToUser(userId, { type: 'permissions_updated' });
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
  const role = state.roles.values().find((r) => r.name === roleName);

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

// POST /__control/billing/paddle-config — set the Paddle.js client token that
// /api/v1/billing/paddle-config advertises. E2E stubs the Paddle.js script, so
// any non-empty token works; null disables the Paddle checkout again.
router.post('/billing/paddle-config', (req, res) => {
  const { clientToken } = req.body as { clientToken?: string | null };

  if (clientToken !== null && typeof clientToken !== 'string') {
    res
      .status(400)
      .json({ message: 'clientToken (string | null) is required' });

    return;
  }

  const state = getState();

  state.paddleClientConfig = {
    ...state.paddleClientConfig,
    clientToken: clientToken || null
  };
  res.json(state.paddleClientConfig);
});

// POST /__control/billing/provider-enabled — set the admin kill-switch flag of
// one billing provider. The real flag is super-admin only, so E2E sets it here.
router.post('/billing/provider-enabled', (req, res) => {
  const { provider, enabled } = req.body as {
    provider?: string;
    enabled?: boolean;
  };

  if (
    typeof enabled !== 'boolean' ||
    !setProviderEnabled(provider ?? '', enabled)
  ) {
    res.status(400).json({
      message: 'provider (paddle | yookassa) and enabled (boolean) are required'
    });

    return;
  }

  res.json({ message: `${provider} ${enabled ? 'enabled' : 'disabled'}` });
});

// POST /__control/billing/activate-subscription - put a user on a plan for E2E
// with no checkout, through the same settlement as the Pay button of the mock
// checkout page.
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

  const plan = state.plans.values().find((p) => p.key === planKey);

  if (!plan) {
    res.status(404).json({ message: `plan "${planKey}" not found` });

    return;
  }

  res.json(
    toSubscriptionResponse(activateSubscription(user, plan, { status }))
  );
});

// POST /__control/billing/seed-usage — pre-seed a usage record for E2E without
// going through the admin ingest endpoint. Attaches to the customer's active
// subscription (or an explicit subscriptionId) so usage views/rating have data.
router.post('/billing/seed-usage', (req, res) => {
  const {
    customerId,
    meterKey,
    quantity,
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
  const subscription = subscriptionId
    ? state.billingSubscriptions.get(subscriptionId)
    : state.billingSubscriptions
        .values()
        .find((s) => s.customerId === customerId);

  if (!subscription) {
    res.status(404).json({ message: 'no subscription for customer' });

    return;
  }

  res.json(
    toUsageResponse(
      seedUsage(subscription, {
        meterKey,
        quantity,
        occurredAt,
        idempotencyKey
      })
    )
  );
});

// POST /__control/billing/complete-purchase - settle a pending purchase for
// E2E, by explicit `sessionRef` or the latest one for `userId`, through the
// same settlement as the Pay button of the mock checkout page.
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
    const customer = state.billingCustomers
      .values()
      .find((c) => c.userId === userId);

    session = customer
      ? [...state.billingPurchaseSessions.values()]
          .filter((s) => s.customerId === customer.id)
          .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;
  }

  if (!session) {
    res.status(404).json({ message: 'pending purchase session not found' });

    return;
  }

  res.json(toInvoiceResponse(settlePurchase(session)));
});

// POST /__control/billing/consume-credits - one pay-as-you-go use for E2E,
// through the same helper as the admin usage route.
router.post('/billing/consume-credits', (req, res) => {
  const { customerId, quantity } = req.body as {
    customerId?: string;
    quantity?: number;
  };

  if (!customerId || !quantity) {
    res.status(400).json({ message: 'customerId and quantity are required' });

    return;
  }

  const outcome = consumeCredits(customerId, {
    meterKey: 'api_calls',
    units: quantity,
    idempotencyKey: `control-${randomUUID()}`,
    occurredAt: new Date().toISOString()
  });

  if ('refusal' in outcome) {
    res.status(409).json(outcome.refusal);

    return;
  }

  res.json(outcome.response);
});

// POST /__control/billing/advance-renewal - renewal-clock advance for E2E:
// one scheduler pass on the current period of the subscription, as if it were
// due now. The semantics are on advanceRenewal.
router.post('/billing/advance-renewal', (req, res) => {
  const {
    userId,
    subscriptionId,
    outcome = 'success'
  } = req.body as {
    userId?: string;
    subscriptionId?: string;
    outcome?: RenewalOutcome;
  };

  if (outcome !== 'success' && outcome !== 'failure') {
    res.status(400).json({ message: 'outcome must be success or failure' });

    return;
  }

  const subscription = findRenewableSubscription({ userId, subscriptionId });

  if (!subscription) {
    res.status(404).json({ message: 'subscription not found' });

    return;
  }

  const advanced = advanceRenewal(subscription, outcome);

  if (!advanced) {
    res.status(404).json({ message: 'plan or price not found' });

    return;
  }

  res.json(toSubscriptionResponse(advanced));
});

export default router;
