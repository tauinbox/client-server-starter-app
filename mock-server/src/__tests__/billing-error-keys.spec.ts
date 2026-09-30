import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';
import type { MockPlan, MockProduct, MockSubscription } from '../types';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  resetState();
  const app = createApp();
  server = await listenOnUnblockedPort(app);
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

async function login(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

// user@example.com has an English locale, so its subscription is on Paddle.
async function activate(): Promise<MockSubscription> {
  const res = await fetch(
    `${baseUrl}/__control/billing/activate-subscription`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: mockId('user-2'), planKey: 'pro' })
    }
  );
  expect(res.status).toBe(200);
  const { id } = (await res.json()) as { id: string };
  const sub = getState().billingSubscriptions.get(id);
  if (!sub) throw new Error('subscription not seeded');
  return sub;
}

function planByKey(key: string): MockPlan {
  const plan = [...getState().plans.values()].find((p) => p.key === key);
  if (!plan) throw new Error(`plan ${key} not seeded`);
  return plan;
}

function productByKey(key: string): MockProduct {
  const product = [...getState().billingProducts.values()].find(
    (p) => p.key === key
  );
  if (!product) throw new Error(`product ${key} not seeded`);
  return product;
}

interface Refusal {
  name: string;
  /** Returns a path that replaces `path` when the route needs a seeded id. */
  arrange?: () => Promise<string | void>;
  as?: string;
  method?: 'GET' | 'PUT';
  path: string;
  body?: unknown;
  status: number;
  errorKey: string;
}

const REFUSALS: Refusal[] = [
  {
    name: 'checkout of an unknown plan',
    path: '/billing/checkout',
    body: { planKey: 'ghost' },
    status: 404,
    errorKey: ErrorKeys.BILLING.PLAN_NOT_FOUND
  },
  {
    name: 'checkout with a live subscription',
    arrange: async () => void (await activate()),
    path: '/billing/checkout',
    body: { planKey: 'business' },
    status: 409,
    errorKey: ErrorKeys.BILLING.ALREADY_SUBSCRIBED
  },
  {
    name: 'purchase of an unknown product',
    path: '/billing/purchase',
    body: { productKey: 'ghost' },
    status: 404,
    errorKey: ErrorKeys.BILLING.PRODUCT_NOT_FOUND
  },
  {
    name: 'purchase of a product with no price for the provider',
    arrange: () => {
      delete productByKey('report-pack').prices.paddle;
      return Promise.resolve();
    },
    path: '/billing/purchase',
    body: { productKey: 'report-pack' },
    status: 409,
    errorKey: ErrorKeys.BILLING.PRODUCT_UNAVAILABLE_FOR_PROVIDER
  },
  {
    name: 'purchase of a product with no amount configured',
    arrange: () => {
      productByKey('report-pack').prices.paddle = { currency: 'USD' };
      return Promise.resolve();
    },
    path: '/billing/purchase',
    body: { productKey: 'report-pack' },
    status: 503,
    errorKey: ErrorKeys.BILLING.PRODUCT_NOT_CONFIGURED
  },
  {
    name: 'custom purchase with no amount',
    path: '/billing/purchase',
    body: { productKey: 'donation' },
    status: 400,
    errorKey: ErrorKeys.BILLING.AMOUNT_REQUIRED
  },
  {
    name: 'custom purchase outside the bounds',
    path: '/billing/purchase',
    body: { productKey: 'donation', amountMinor: 99 },
    status: 400,
    errorKey: ErrorKeys.BILLING.AMOUNT_OUT_OF_RANGE
  },
  {
    name: 'payment-method update with no subscription',
    path: '/billing/payment-method',
    status: 404,
    errorKey: ErrorKeys.BILLING.NO_ACTIVE_SUBSCRIPTION
  },
  {
    name: 'plan change with no subscription',
    path: '/billing/subscription/change',
    body: { planKey: 'business' },
    status: 404,
    errorKey: ErrorKeys.BILLING.NO_ACTIVE_SUBSCRIPTION
  },
  {
    name: 'cancel with no subscription',
    path: '/billing/subscription/cancel',
    status: 404,
    errorKey: ErrorKeys.BILLING.NO_ACTIVE_SUBSCRIPTION
  },
  {
    name: 'plan change of a subscription that is not active',
    arrange: async () => {
      (await activate()).status = 'past_due';
    },
    path: '/billing/subscription/change',
    body: { planKey: 'business' },
    status: 409,
    errorKey: ErrorKeys.BILLING.SUBSCRIPTION_NOT_CHANGEABLE
  },
  {
    name: 'plan change with a scheduled cancellation',
    arrange: async () => {
      (await activate()).cancelAtPeriodEnd = true;
    },
    path: '/billing/subscription/change',
    body: { planKey: 'business' },
    status: 409,
    errorKey: ErrorKeys.BILLING.CANCELLATION_SCHEDULED
  },
  {
    name: 'self-managed plan change after the period end',
    arrange: async () => {
      const sub = await activate();
      sub.lifecycleOwner = 'self';
      sub.currentPeriodEnd = new Date(Date.now() - 1000).toISOString();
    },
    path: '/billing/subscription/change/preview',
    body: { planKey: 'business' },
    status: 409,
    errorKey: ErrorKeys.BILLING.RENEWAL_IN_PROGRESS
  },
  {
    name: 'plan change to an unknown plan',
    arrange: async () => void (await activate()),
    path: '/billing/subscription/change',
    body: { planKey: 'ghost' },
    status: 404,
    errorKey: ErrorKeys.BILLING.PLAN_NOT_FOUND
  },
  {
    name: 'plan change to the current plan',
    arrange: async () => void (await activate()),
    path: '/billing/subscription/change',
    body: { planKey: 'pro' },
    status: 409,
    errorKey: ErrorKeys.BILLING.SAME_PLAN
  },
  {
    name: 'plan change to a plan with no price for the provider',
    arrange: async () => {
      await activate();
      delete planByKey('business').prices.paddle;
    },
    path: '/billing/subscription/change',
    body: { planKey: 'business' },
    status: 409,
    errorKey: ErrorKeys.BILLING.PLAN_UNAVAILABLE_FOR_PROVIDER
  },
  {
    name: 'region change that would orphan a live subscription',
    arrange: async () => void (await activate()),
    method: 'PUT',
    path: '/billing/region',
    body: { region: 'ru' },
    status: 409,
    errorKey: ErrorKeys.BILLING.REGION_CHANGE_BLOCKED
  },
  {
    name: 'entitlement-gated route on the Free tier',
    method: 'GET',
    path: '/billing/premium-content',
    status: 403,
    errorKey: ErrorKeys.BILLING.ENTITLEMENT_REQUIRED
  },
  {
    name: 'admin cancel of a canceled subscription',
    arrange: async () => {
      const sub = await activate();
      sub.status = 'canceled';
      return `/admin/billing/subscriptions/${sub.id}/cancel`;
    },
    as: 'admin@example.com',
    path: '',
    status: 409,
    errorKey: ErrorKeys.BILLING.SUBSCRIPTION_ALREADY_CANCELED
  }
];

describe('billing refusals carry the error key of the server', () => {
  it.each(REFUSALS)('$name', async (refusal) => {
    const path = (await refusal.arrange?.()) ?? refusal.path;
    const token = await login(refusal.as ?? 'user@example.com');
    const method = refusal.method ?? 'POST';

    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: method === 'GET' ? undefined : JSON.stringify(refusal.body ?? {})
    });

    expect(res.status).toBe(refusal.status);
    expect(await res.json()).toMatchObject({
      errorKey: refusal.errorKey,
      statusCode: refusal.status
    });
  });
});
