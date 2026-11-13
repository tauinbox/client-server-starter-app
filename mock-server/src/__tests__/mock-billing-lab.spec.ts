import type { Server } from 'http';
import type {
  PlanResponse,
  SubscriptionResponse,
  UsageSummaryResponse
} from '@app/shared/types';
import { createApp } from '../app';
import { MOCK_BILLING_LAB_PATH } from '../routes/mock-billing-lab';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

async function login(): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'user@example.com', password: 'Password1' })
  });
  const body = (await res.json()) as {
    tokens: { access_token: string };
    user: { id: string };
  };

  return { token: body.tokens.access_token, userId: body.user.id };
}

async function lab(
  action: string,
  body: Record<string, string>
): Promise<{ status: number; message: string }> {
  const res = await fetch(`${baseUrl}${MOCK_BILLING_LAB_PATH}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const { message } = (await res.json()) as { message: string };

  return { status: res.status, message };
}

async function read<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });

  return (await res.json()) as T;
}

describe('billing lab', () => {
  it('renders the page with the presets and the state of the user', async () => {
    const { userId } = await login();
    const res = await fetch(
      `${baseUrl}${MOCK_BILLING_LAB_PATH}?userId=${userId}`
    );
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('Billing lab');
    expect(html).toContain('Pay as you go, balance 500');
    expect(html).toContain('No billing customer yet');
  });

  it.each([
    ['payg-funded', 500, 'usage'],
    ['payg-empty', 0, 'free']
  ])(
    'puts a user on the %s preset: a balance of %i, no subscription, the %s plan',
    async (preset, units, planKey) => {
      const { token, userId } = await login();

      expect(
        await lab('preset', { userId, preset, provider: 'auto' })
      ).toMatchObject({ status: 200 });

      expect(
        await read<SubscriptionResponse | null>(token, '/billing/subscription')
      ).toBeNull();
      expect(
        await read<{ balanceUnits: number }>(token, '/billing/credits')
      ).toMatchObject({ balanceUnits: units });
      expect(
        await read<{ planKey: string }>(token, '/billing/entitlements')
      ).toMatchObject({ planKey });
    }
  );

  it('starts every preset from Free and closes the open subscription', async () => {
    const { token, userId } = await login();

    await lab('preset', { userId, preset: 'canceling', provider: 'auto' });
    expect(
      await read<SubscriptionResponse>(token, '/billing/subscription')
    ).toMatchObject({ planKey: 'pro', cancelAtPeriodEnd: true });

    await lab('preset', { userId, preset: 'trialing', provider: 'auto' });
    const trial = await read<SubscriptionResponse>(
      token,
      '/billing/subscription'
    );

    expect(trial).toMatchObject({
      status: 'trialing',
      cancelAtPeriodEnd: false
    });
    expect(trial.trialEnd).toBe(trial.currentPeriodEnd);

    await lab('preset', { userId, preset: 'free', provider: 'auto' });
    expect(
      await read<SubscriptionResponse | null>(token, '/billing/subscription')
    ).toBeNull();
  });

  it('uses units from the credits, and refuses a use that the balance does not cover', async () => {
    const { token, userId } = await login();

    await lab('preset', { userId, preset: 'payg-funded', provider: 'auto' });
    expect(await lab('usage', { userId, quantity: '42' })).toEqual({
      status: 200,
      message: 'Used 42 units; 458 credits left'
    });
    expect(
      (await read<UsageSummaryResponse>(token, '/billing/usage')).unitsSpent
    ).toBe(42);
    expect(await lab('usage', { userId, quantity: '459' })).toMatchObject({
      status: 400
    });
  });

  it('runs the renewal clock into dunning', async () => {
    const { userId } = await login();

    await lab('preset', { userId, preset: 'pro', provider: 'auto' });
    expect(await lab('renewal', { userId, outcome: 'failure' })).toEqual({
      status: 200,
      message: 'Renewal failure: the subscription is past_due'
    });
  });

  it('sets the trial days of a plan in the catalog', async () => {
    expect(await lab('trial', { planKey: 'pro', days: '7' })).toMatchObject({
      status: 200
    });

    const plans = await read<PlanResponse[]>('', '/billing/plans');

    expect(plans.find((p) => p.key === 'pro')?.trialDays).toBe(7);
  });

  it('refuses an action without the state it needs', async () => {
    const { userId } = await login();

    expect((await lab('usage', { userId, quantity: '5' })).status).toBe(400);
    expect((await lab('credits', { userId, units: '5' })).status).toBe(400);
    expect(
      (await lab('preset', { userId, preset: 'gold', provider: 'auto' })).status
    ).toBe(400);
  });
});
