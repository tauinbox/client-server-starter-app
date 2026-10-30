import type { Server } from 'http';
import { randomUUID } from 'crypto';
import { MAX_FAILED_ATTEMPTS } from '@app/shared/constants';
import {
  ACTOR_FIXTURES,
  ActorFixture,
  expectedAnswers,
  loadScenarioFiles,
  RequestScenario,
  resolvePlaceholders,
  SCENARIO_NEW_PASSWORD,
  SCENARIO_PASSWORD,
  SCENARIO_RECOVERY_CODE,
  ScenarioPlaceholder,
  scenarioMethod,
  scenarioPath,
  StateFixture
} from '@app/shared/utils/request-scenarios';
import { createApp } from '../app';
import { MOCK_TOTP_CODE, MOCK_TOTP_SECRET } from '../constants';
import { recordFailure } from '../helpers/reauth.helpers';
import { addOAuthAccounts, getState, resetState } from '../state';
import type { MockIssuedToken, MockUser } from '../types';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';

// Runs every scenario of contracts/scenarios against the mock server. The
// server e2e suite runs the same files against the real server.

const DAY_MS = 24 * 3600_000;

interface Answer {
  status: number;
  errorKey: string | null;
}

interface Context {
  actor?: MockUser;
  target?: MockUser;
  bearer?: string;
  cookies: string[];
  values: Partial<Record<ScenarioPlaceholder, string>>;
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

function call(
  method: string,
  path: string,
  options: {
    body?: unknown;
    bearer?: string;
    cookies?: string[];
    headers?: Record<string, string>;
  } = {}
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...options.headers,
      'content-type': 'application/json',
      ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
      ...(options.cookies?.length ? { cookie: options.cookies.join('; ') } : {})
    },
    body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {})
  });
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`${res.url} answered ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

function cookieOf(res: Response, name: string): string {
  const line = res.headers.getSetCookie().find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`the response set no ${name} cookie`);
  return line.split(';')[0];
}

const ACTORS: Record<ActorFixture, (user: MockUser) => void> = {
  admin: (u) => {
    u.roles = ['admin'];
  },
  user: () => undefined,
  'user-no-roles': (u) => {
    u.roles = [];
  },
  'user-mfa': (u) => {
    u.totpSecret = MOCK_TOTP_SECRET;
    u.totpEnabledAt = new Date().toISOString();
    u.totpRecoveryCodes = [SCENARIO_RECOVERY_CODE];
  },
  'oauth-only': (u) => {
    u.password = null;
    addOAuthAccounts(u.id, [
      {
        provider: 'google',
        providerId: `google-${u.id}`,
        createdAt: new Date().toISOString()
      }
    ]);
  },
  unverified: (u) => {
    u.isEmailVerified = false;
  },
  locked: (u) => {
    u.failedLoginAttempts = MAX_FAILED_ATTEMPTS;
    u.lockedUntil = new Date(Date.now() + 3600_000).toISOString();
  }
};

let sequence = 0;
function freshEmail(): string {
  sequence += 1;
  return `scenario-${sequence}@example.com`;
}

function createAccount(fixture: ActorFixture): MockUser {
  const now = new Date().toISOString();
  const user: MockUser = {
    id: randomUUID(),
    email: freshEmail(),
    name: 'Scenario Owner',
    password: SCENARIO_PASSWORD,
    isActive: true,
    roles: ['user'],
    isEmailVerified: true,
    locale: 'en',
    failedLoginAttempts: 0,
    lockedUntil: null,
    tokenRevokedAt: null,
    totpSecret: null,
    totpEnabledAt: null,
    totpRecoveryCodes: null,
    totpLastUsedStep: null,
    pendingEmail: null,
    pendingEmailToken: null,
    pendingEmailExpiresAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
  getState().users.set(user.id, user);
  ACTORS[fixture](user);
  return user;
}

/** A session of the account, through the sign-in route it would use. */
async function signIn(user: MockUser) {
  let res: Response;
  if (user.password === null) {
    const { token } = await json<{ token: string }>(
      await call('POST', '/__control/oauth-data', { body: { userId: user.id } })
    );
    res = await call('POST', '/api/v1/auth/oauth/exchange', {
      cookies: [`oauth_data=${token}`]
    });
  } else {
    res = await call('POST', '/api/v1/auth/login', {
      body: { email: user.email, password: SCENARIO_PASSWORD }
    });
    if (user.totpEnabledAt) {
      const { mfaToken } = await json<{ mfaToken: string }>(res);
      res = await call('POST', '/api/v1/auth/mfa/verify', {
        body: { mfaToken, code: MOCK_TOTP_CODE }
      });
    }
  }
  const cookie = cookieOf(res, 'refresh_token');
  const { tokens } = await json<{ tokens: { access_token: string } }>(res);
  return { bearer: tokens.access_token, cookie };
}

function tokenOf(tokens: Map<string, MockIssuedToken>, userId: string) {
  const found = [...tokens.entries()].find(([, t]) => t.userId === userId);
  if (!found) throw new Error(`no mailed token for ${userId}`);
  return found[0];
}

const STATES: Record<StateFixture, (ctx: Context) => Promise<void>> = {
  'refresh-cookie': async (ctx) => {
    const session = await signIn(ctx.actor!);
    ctx.bearer = session.bearer;
    ctx.cookies.push(session.cookie);
  },
  'second-session': async (ctx) => {
    await signIn(ctx.actor!);
    const sessions = await json<Array<{ id: string; current: boolean }>>(
      await call('GET', '/api/v1/auth/sessions', { bearer: ctx.bearer })
    );
    ctx.values.$otherSessionId = sessions.find((s) => !s.current)!.id;
  },
  'verification-token': async (ctx) => {
    await json(
      await call('POST', '/api/v1/auth/resend-verification', {
        body: { email: ctx.actor!.email }
      })
    );
    ctx.values.$verificationToken = tokenOf(
      getState().emailVerificationTokens,
      ctx.actor!.id
    );
  },
  'reset-token': async (ctx) => {
    await json(
      await call('POST', '/api/v1/auth/forgot-password', {
        body: { email: ctx.actor!.email }
      })
    );
    ctx.values.$resetToken = tokenOf(
      getState().passwordResetTokens,
      ctx.actor!.id
    );
  },
  'email-change-token': async (ctx) => {
    const { bearer } = await signIn(ctx.actor!);
    await json(
      await call('POST', '/api/v1/auth/profile/email/initiate', {
        bearer,
        body: {
          newEmail: ctx.values.$newEmail,
          currentPassword: SCENARIO_PASSWORD
        }
      })
    );
    const found = [...getState().pendingEmailTokens.entries()].find(
      ([, userId]) => userId === ctx.actor!.id
    );
    ctx.values.$emailChangeToken = found![0];
  },
  'mfa-setup': async (ctx) => {
    await json(
      await call('POST', '/api/v1/auth/mfa/setup', {
        bearer: ctx.bearer,
        body: { currentPassword: SCENARIO_PASSWORD }
      })
    );
    ctx.values.$setupCode = MOCK_TOTP_CODE;
  },
  'mfa-challenge': async (ctx) => {
    const { mfaToken } = await json<{ mfaToken: string }>(
      await call('POST', '/api/v1/auth/login', {
        body: { email: ctx.actor!.email, password: SCENARIO_PASSWORD }
      })
    );
    ctx.values.$mfaToken = mfaToken;
  },
  'oauth-data': async (ctx) => {
    const { token } = await json<{ token: string }>(
      await call('POST', '/__control/oauth-data', {
        body: { userId: ctx.actor!.id }
      })
    );
    ctx.cookies.push(`oauth_data=${token}`);
  },
  'step-up-code-failures': (ctx) => {
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      recordFailure(getState().mfaStepUpFailures, ctx.actor!.id);
    }
    return Promise.resolve();
  },
  'vk-linked': (ctx) => {
    addOAuthAccounts(ctx.actor!.id, [
      {
        provider: 'vk',
        providerId: `vk-${ctx.actor!.id}`,
        createdAt: new Date().toISOString()
      }
    ]);
    return Promise.resolve();
  },
  'custom-role': (ctx) => {
    const now = new Date().toISOString();
    const role = {
      id: randomUUID(),
      name: ctx.values.$roleName!,
      description: null,
      isSystem: false,
      isSuper: false,
      createdAt: now,
      updatedAt: now
    };
    getState().roles.set(role.id, role);
    ctx.values.$roleId = role.id;
    return Promise.resolve();
  },
  'role-permission': (ctx) => {
    getState().rolePermissions.push({
      id: randomUUID(),
      roleId: ctx.values.$roleId!,
      permissionId: ctx.values.$permissionId!,
      conditions: null
    });
    return Promise.resolve();
  },
  'target-role': (ctx) => {
    ctx.target!.roles.push(getState().roles.get(ctx.values.$roleId!)!.name);
    return Promise.resolve();
  },
  resource: (ctx) => {
    const now = new Date().toISOString();
    const id = randomUUID();
    getState().resources.set(id, {
      id,
      name: `scenario-resource-${sequence}`,
      subject: `ScenarioResource${sequence}`,
      displayName: 'Scenario resource',
      description: null,
      isSystem: false,
      isOrphaned: false,
      isRegistered: true,
      actionNames: ['read', 'update'],
      conditionalActionNames: [],
      allowedActionNames: null,
      lastSyncedAt: now,
      createdAt: now
    });
    ctx.values.$resourceId = id;
    return Promise.resolve();
  },
  'orphaned-resource': (ctx) => {
    getState().resources.get(ctx.values.$resourceId!)!.isOrphaned = true;
    return Promise.resolve();
  },
  'unregistered-resource': (ctx) => {
    getState().resources.get(ctx.values.$resourceId!)!.isRegistered = false;
    return Promise.resolve();
  },
  'deleted-target': (ctx) => {
    ctx.target!.deletedAt = new Date().toISOString();
    return Promise.resolve();
  },
  'feature-flag': (ctx) => {
    const now = new Date().toISOString();
    const id = randomUUID();
    getState().featureFlags.set(id, {
      id,
      key: ctx.values.$flagKey!,
      description: null,
      enabled: false,
      environments: [],
      public: false,
      version: 1,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now
    });
    ctx.values.$flagId = id;
    return Promise.resolve();
  },
  subscription: (ctx) => {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const customerId = randomUUID();
    const subscriptionId = randomUUID();
    getState().billingCustomers.set(customerId, {
      id: customerId,
      userId: ctx.actor!.id,
      provider: 'yookassa',
      providerOverride: null,
      country: 'RU',
      currency: 'RUB',
      defaultPaymentMethodId: null,
      trialUsedAt: null,
      createdAt: now,
      updatedAt: now
    });
    getState().billingSubscriptions.set(subscriptionId, {
      id: subscriptionId,
      customerId,
      planKey: ctx.values.$meterKey!,
      provider: 'yookassa',
      billingMode: 'fixed',
      status: 'active',
      lifecycleOwner: 'self',
      currentPeriodStart: new Date(nowMs - DAY_MS).toISOString(),
      currentPeriodEnd: new Date(nowMs + 29 * DAY_MS).toISOString(),
      cancelAtPeriodEnd: false,
      trialEnd: null,
      paymentMethodId: null,
      providerSubscriptionId: null,
      createdAt: now,
      updatedAt: now
    });
    ctx.values.$customerId = customerId;
    ctx.values.$subscriptionId = subscriptionId;
    return Promise.resolve();
  },
  'paid-invoice': (ctx) => {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const id = randomUUID();
    getState().billingInvoices.set(id, {
      id,
      customerId: ctx.values.$customerId!,
      subscriptionId: ctx.values.$subscriptionId!,
      provider: 'yookassa',
      providerInvoiceRef: `scenario-payment-${sequence}`,
      amountMinor: 1000,
      refundedMinor: 0,
      currency: 'RUB',
      status: 'paid',
      billingMode: 'fixed',
      kind: 'subscription',
      productId: null,
      periodStart: new Date(nowMs - DAY_MS).toISOString(),
      periodEnd: new Date(nowMs + 29 * DAY_MS).toISOString(),
      paidAt: now,
      receiptRef: null,
      createdAt: now,
      updatedAt: now
    });
    ctx.values.$invoiceId = id;
    return Promise.resolve();
  },
  'metered-plan': (ctx) => {
    const now = new Date().toISOString();
    const id = randomUUID();
    getState().plans.set(id, {
      id,
      key: ctx.values.$meterKey!,
      name: 'Scenario plan',
      description: null,
      billingMode: 'usage',
      interval: 'month',
      meterKey: ctx.values.$meterKey!,
      entitlements: [],
      limits: null,
      trialDays: 0,
      active: true,
      prices: {},
      createdAt: now,
      updatedAt: now
    });
    return Promise.resolve();
  },
  'dead-letter-webhook-event': (ctx) => {
    const id = randomUUID();
    getState().billingWebhookEvents.set(id, {
      id,
      provider: 'yookassa',
      providerEventId: `scenario-event-${sequence}`,
      type: 'payment.succeeded',
      status: 'dead_letter',
      attempts: 5,
      lastError: 'scenario',
      receivedAt: new Date().toISOString()
    });
    ctx.values.$webhookEventId = id;
    return Promise.resolve();
  }
};

/** The id of the `read:Role` permission. */
function readRolePermissionId(): string {
  const state = getState();
  const found = [...state.permissions.values()].find(
    (p) =>
      state.resources.get(p.resourceId)?.name === 'roles' &&
      state.actions.get(p.actionId)?.name === 'read'
  );
  if (!found) throw new Error('the seed has no read:Role permission');
  return found.id;
}

/** The actions of the audit rows that name one of the accounts. */
function auditActions(ids: string[], emails: string[], from: number) {
  return getState()
    .auditLogs.slice(from)
    .filter(
      (row) =>
        (row.actorId !== null && ids.includes(row.actorId)) ||
        (row.targetId !== null && ids.includes(row.targetId)) ||
        (row.actorEmail !== null && emails.includes(row.actorEmail))
    )
    .map((row) => row.action);
}

async function run(scenario: RequestScenario) {
  resetState();
  const ctx: Context = { cookies: [], values: {} };
  ctx.values.$password = SCENARIO_PASSWORD;
  ctx.values.$newPassword = SCENARIO_NEW_PASSWORD;
  ctx.values.$recoveryCode = SCENARIO_RECOVERY_CODE;
  ctx.values.$newEmail = freshEmail();
  ctx.values.$roleName = `scenario-role-${sequence}`;
  ctx.values.$flagKey = `scenario-flag-${sequence}`;
  ctx.values.$meterKey = `scenario-meter-${sequence}`;
  ctx.values.$permissionId = readRolePermissionId();
  const accounts: MockUser[] = [];

  if (scenario.actor) {
    ctx.actor = createAccount(scenario.actor);
    ctx.values.$email = ctx.actor.email;
    ctx.values.$actorId = ctx.actor.id;
    accounts.push(ctx.actor);
  }
  if (scenario.target) {
    ctx.target = createAccount(scenario.target);
    ctx.values.$targetId = ctx.target.id;
    accounts.push(ctx.target);
  }
  const states = scenario.state ?? [];
  if (scenario.auth === 'bearer' && !states.includes('refresh-cookie')) {
    ctx.bearer = (await signIn(ctx.actor!)).bearer;
  }
  for (const state of states) {
    await STATES[state](ctx);
  }
  if (ctx.actor && scenario.actor === 'user-mfa') {
    // A code is single use: the fixtures above may have spent this step.
    ctx.actor.totpLastUsedStep = null;
    ctx.values.$code = MOCK_TOTP_CODE;
  }

  const from = getState().auditLogs.length;
  const path = scenarioPath(scenario, ctx.values);
  const body = resolvePlaceholders(scenario.body ?? {}, ctx.values);
  const headers = resolvePlaceholders(scenario.headers ?? {}, ctx.values);
  const answers: Answer[] = [];
  for (let i = 0; i < (scenario.repeat ?? 1); i++) {
    const res = await call(scenarioMethod(scenario), path, {
      body,
      headers,
      bearer: scenario.auth === 'bearer' ? ctx.bearer : undefined,
      cookies: ctx.cookies
    });
    const parsed = (await res.json().catch(() => ({}))) as {
      errorKey?: string;
    };
    answers.push({ status: res.status, errorKey: parsed.errorKey ?? null });
  }

  // A registration creates its account in the request.
  const emails = [ctx.values.$newEmail, ...accounts.map((a) => a.email)];
  const ids = [...getState().users.values()]
    .filter((u) => emails.includes(u.email))
    .map((u) => u.id);
  return { answers, audit: auditActions(ids, emails, from) };
}

it('builds every actor fixture', () => {
  expect(Object.keys(ACTORS).sort()).toEqual([...ACTOR_FIXTURES].sort());
});

for (const { file, scenarios } of loadScenarioFiles()) {
  describe(file, () => {
    it.each(scenarios.map((s) => [s.name, s] as const))(
      '%s',
      async (_name, scenario) => {
        const { answers, audit } = await run(scenario);
        // The server writes some rows fire-and-forget, so the order is free.
        expect({ answers, audit: [...audit].sort() }).toEqual({
          answers: expectedAnswers(scenario),
          audit: [...scenario.expect.audit].sort()
        });
      }
    );
  });
}
