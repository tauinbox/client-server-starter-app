import { AsyncLocalStorage } from 'node:async_hooks';
import type { Response } from 'express';
import { HOME_DATA_REGION, type DataRegion } from '@app/shared/constants';
import type { State } from './types';
import {
  seedOAuthAccounts,
  seedUsers,
  seedResources,
  seedActions,
  seedRoles,
  seedPermissions,
  seedRolePermissions,
  seedFeatureFlags,
  seedFeatureFlagRules,
  seedPlans,
  seedProducts,
  seedBreachedPasswords
} from './seed';

/**
 * One mock server of one region: its own store, its SSE connections and its
 * pending flag broadcast, as one pool of the server has its own database and
 * its own nodes. Several instances can run in one process side by side, so a
 * client e2e can start one for each region.
 */
export interface MockInstance {
  readonly region: DataRegion;
  state: State;
  /** userId to connectionId to the open stream. */
  readonly sseConnections: Map<string, Map<string, Response>>;
  flagsBroadcastTimer: ReturnType<typeof setTimeout> | null;
}

export function freshState(): State {
  return {
    // `roles` is copied too: assigning a role pushes into the array, so a
    // shallow copy would let one test's assignment survive the next reset.
    users: new Map(seedUsers.map((u) => [u.id, { ...u, roles: [...u.roles] }])),
    oauthAccounts: new Map(
      Array.from(seedOAuthAccounts.entries()).map(([k, v]) => [
        k,
        v.map((a) => ({ ...a }))
      ])
    ),
    oauthDataTokens: new Map(),
    oauthSignupTokens: new Map(),
    reauthProofs: new Map(),
    refreshTokens: new Map(),
    refreshSessions: new Map(),
    sessionStarts: new Map(),
    sessionUserAgents: new Map(),
    sessionIps: new Map(),
    sessionLastActive: new Map(),
    revokedRefreshTokens: new Map(),
    rotatedTo: new Map(),
    emailVerificationTokens: new Map(),
    passwordResetTokens: new Map(),
    pendingEmailTokens: new Map(),
    resources: new Map(seedResources.map((r) => [r.id, { ...r }])),
    actions: new Map(seedActions.map((a) => [a.id, { ...a }])),
    roles: new Map(seedRoles.map((r) => [r.id, { ...r }])),
    permissions: new Map(seedPermissions.map((p) => [p.id, { ...p }])),
    rolePermissions: seedRolePermissions.map((rp) => ({ ...rp })),
    auditLogs: [],
    paddleClientConfig: { clientToken: null, environment: 'sandbox' },
    captchaConfig: { enabled: false, provider: null, siteKey: null },
    regionPeers: {},
    captchaAttempts: new Map(),
    mfaChallengeFailures: new Map(),
    mfaStepUpFailures: new Map(),
    stepUpPasswordFailures: new Map(),
    breachedPasswords: new Set(seedBreachedPasswords),
    featureFlags: new Map(seedFeatureFlags.map((f) => [f.id, { ...f }])),
    featureFlagRules: seedFeatureFlagRules.map((r) => ({
      ...r,
      payload: { ...r.payload }
    })),
    // Deep copies: `prices` is nested, and a shallow copy lets an edit of it
    // leak into the seed and survive the next reset.
    plans: new Map(seedPlans.map((p) => [p.id, structuredClone(p)])),
    billingProducts: new Map(
      seedProducts.map((p) => [p.id, structuredClone(p)])
    ),
    billingCustomers: new Map(),
    billingSubscriptions: new Map(),
    billingUsageRecords: new Map(),
    billingInvoices: new Map(),
    billingPaymentMethods: new Map(),
    billingCustomerGrants: new Map(),
    billingPurchaseSessions: new Map(),
    billingCheckoutSessions: new Map(),
    billingCreditBalances: new Map(),
    billingWebhookEvents: new Map(),
    billingConsents: [],
    legalTermsOverrides: {},
    userNotifications: new Map()
  };
}

export function createMockInstance(region: DataRegion): MockInstance {
  return {
    region,
    state: freshState(),
    sseConnections: new Map(),
    flagsBroadcastTimer: null
  };
}

// The instance of the home region, as production runs it. Code that runs
// outside a request (a unit spec, the e2e fixture) uses it.
export const defaultInstance = createMockInstance(HOME_DATA_REGION);

const boundInstance = new AsyncLocalStorage<MockInstance>();

/** Runs `fn`, and every callback that it schedules, against `instance`. */
export function runInInstance<T>(instance: MockInstance, fn: () => T): T {
  return boundInstance.run(instance, fn);
}

export function currentInstance(): MockInstance {
  return boundInstance.getStore() ?? defaultInstance;
}

/** Mirrors `DATA_REGION` of the server. */
export function mockRegion(): DataRegion {
  return currentInstance().region;
}
