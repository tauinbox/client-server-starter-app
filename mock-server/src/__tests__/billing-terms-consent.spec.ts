import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { readErrorBody } from '../utils/error-body';

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

function call(
  token: string,
  { method, path, body }: { method: string; path: string; body?: unknown }
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/billing/${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function publishTerms(
  jurisdiction: 'ru' | 'intl',
  version: string | null
): Promise<void> {
  const res = await fetch(`${baseUrl}/__control/billing/terms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jurisdiction, version })
  });

  expect(res.status).toBe(200);
}

/** A signed-in user on the `ru` region, which YooKassa serves. */
async function ruBuyer(): Promise<string> {
  const token = await login('user@example.com');
  const res = await call(token, {
    method: 'PUT',
    path: 'region',
    body: { region: 'ru' }
  });

  expect(res.status).toBe(200);

  return token;
}

const termsAudit = () =>
  getState().auditLogs.filter((row) => row.action === 'BILLING_TERMS_ACCEPT');

describe('GET /billing/region termsVersion (server parity)', () => {
  it('reports null while the terms are a draft, and the version once published', async () => {
    const token = await ruBuyer();
    const read = async () =>
      (
        (await (
          await call(token, { method: 'GET', path: 'region' })
        ).json()) as {
          termsVersion: unknown;
        }
      ).termsVersion;

    expect(await read()).toBeNull();

    await publishTerms('intl', '2030-02-02');
    expect(await read()).toBeNull();

    await publishTerms('ru', '2030-01-01');
    expect(await read()).toBe('2030-01-01');

    await publishTerms('ru', null);
    expect(await read()).toBeNull();
  });
});

describe('consent to the terms at checkout and purchase (server parity)', () => {
  it('refuses a checkout without the version and writes nothing', async () => {
    const token = await ruBuyer();

    await publishTerms('ru', '2030-01-01');

    const res = await call(token, {
      method: 'POST',
      path: 'checkout',
      body: { planKey: 'pro' }
    });

    expect(res.status).toBe(422);
    expect(await readErrorBody(res)).toEqual({
      statusCode: 422,
      errorKey: ErrorKeys.BILLING.TERMS_NOT_ACCEPTED,
      message: 'Accept the current terms of service to continue.'
    });
    expect(getState().billingConsents).toEqual([]);
    expect(termsAudit()).toEqual([]);
    expect([...getState().billingSubscriptions.values()]).toEqual([]);
  });

  it('records one consent and one audit row for a version, however often it is accepted', async () => {
    const token = await ruBuyer();
    const { id: userId } = getState()
      .users.values()
      .find((user) => user.email === 'user@example.com')!;

    await publishTerms('ru', '2030-01-01');

    const checkout = await call(token, {
      method: 'POST',
      path: 'checkout',
      body: { planKey: 'pro', acceptedTermsVersion: '2030-01-01' }
    });
    const purchase = await call(token, {
      method: 'POST',
      path: 'purchase',
      body: { productKey: 'report-pack', acceptedTermsVersion: '2030-01-01' }
    });

    expect(checkout.status).toBe(200);
    expect(purchase.status).toBe(200);
    expect(getState().billingConsents).toEqual([
      {
        id: expect.any(String),
        userId,
        kind: 'terms',
        jurisdiction: 'ru',
        documentVersion: '2030-01-01',
        acceptedAt: expect.any(String)
      }
    ]);
    expect(termsAudit()).toEqual([
      expect.objectContaining({
        actorId: userId,
        actorEmail: 'user@example.com',
        targetId: getState().billingConsents[0].id,
        targetType: 'BillingConsent',
        details: { jurisdiction: 'ru', version: '2030-01-01' }
      })
    ]);
  });

  it('asks for no consent while the terms are a draft', async () => {
    const token = await ruBuyer();

    const res = await call(token, {
      method: 'POST',
      path: 'checkout',
      body: { planKey: 'pro', acceptedTermsVersion: '2030-01-01' }
    });

    expect(res.status).toBe(200);
    expect(getState().billingConsents).toEqual([]);
    expect(termsAudit()).toEqual([]);
  });

  it.each([
    ['checkout', { planKey: 'pro' }],
    ['purchase', { productKey: 'report-pack' }]
  ])(
    'rejects a %s whose accepted terms version is not a short string',
    async (path, body) => {
      const token = await ruBuyer();

      for (const acceptedTermsVersion of [42, null, 'x'.repeat(33)]) {
        const res = await call(token, {
          method: 'POST',
          path,
          body: { ...body, acceptedTermsVersion }
        });

        expect(res.status).toBe(422);
      }
    }
  );
});
