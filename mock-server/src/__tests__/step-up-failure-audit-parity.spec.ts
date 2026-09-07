import type { Server } from 'http';
import { STEP_UP_OPERATION } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockAuditLog, MockUser } from '../types';

let server: Server;
let baseUrl: string;

const CREDENTIALS = { email: 'user@example.com', password: 'Password1' };
const OAUTH_ONLY_ID = '910';
const NEW_PASSWORD = 'Sunrise-Kettle-19';

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

function failureRows(): MockAuditLog[] {
  return getState().auditLogs.filter((row) => row.action === 'STEP_UP_FAILURE');
}

function post(
  path: string,
  body: unknown,
  accessToken?: string
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(body)
  });
}

async function accessToken(): Promise<string> {
  const res = await post('/auth/login', CREDENTIALS);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

function seedOAuthOnlyUser(): void {
  const template = [...getState().users.values()].find(
    (u) => u.email === CREDENTIALS.email
  ) as MockUser;

  getState().users.set(OAUTH_ONLY_ID, {
    ...template,
    id: OAUTH_ONLY_ID,
    email: 'provider-only@example.com',
    password: null
  });
}

async function oauthOnlyToken(): Promise<string> {
  const dataRes = await fetch(`${baseUrl}/__control/oauth-data`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: OAUTH_ONLY_ID })
  });
  const { token } = (await dataRes.json()) as { token: string };

  const exchange = await fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
    method: 'POST',
    headers: { cookie: `oauth_data=${token}` }
  });
  const body = (await exchange.json()) as {
    tokens: { access_token: string };
  };
  return body.tokens.access_token;
}

describe('a refused step-up is audited', () => {
  it('audits a wrong password on the two-factor setup', async () => {
    const token = await accessToken();

    const res = await post(
      '/auth/mfa/setup',
      { currentPassword: 'WrongPassword1' },
      token
    );

    expect(res.status).toBe(400);
    expect(failureRows()).toHaveLength(1);
    expect(failureRows()[0]).toMatchObject({
      actorEmail: CREDENTIALS.email,
      targetType: 'User',
      details: {
        operation: STEP_UP_OPERATION.MFA_SETUP,
        factor: 'password',
        codeOffered: false
      }
    });
  });

  it('audits a wrong code on the two-factor disable, and records no value', async () => {
    const token = await accessToken();
    await post(
      '/auth/mfa/setup',
      { currentPassword: CREDENTIALS.password },
      token
    );

    const res = await post('/auth/mfa/disable', { code: '000000' }, token);

    expect(res.status).toBe(400);
    expect(failureRows()).toHaveLength(1);
    expect(failureRows()[0].details).toEqual({
      operation: STEP_UP_OPERATION.MFA_DISABLE,
      factor: 'password',
      codeOffered: true
    });
    expect(JSON.stringify(failureRows())).not.toContain('000000');
  });

  it('audits a missing provider proof on a first password', async () => {
    seedOAuthOnlyUser();
    const token = await oauthOnlyToken();

    const res = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ password: NEW_PASSWORD })
    });

    expect(res.status).toBe(400);
    expect(failureRows()[0].details).toEqual({
      operation: STEP_UP_OPERATION.PASSWORD_SET,
      factor: 'reauth_proof',
      codeOffered: false
    });
  });

  it('audits a wrong password on the email change', async () => {
    const token = await accessToken();

    const res = await post(
      '/auth/profile/email/initiate',
      { newEmail: 'new@example.com', currentPassword: 'WrongPassword1' },
      token
    );

    expect(res.status).toBe(400);
    expect(failureRows()[0].details).toEqual({
      operation: STEP_UP_OPERATION.EMAIL_CHANGE,
      factor: 'password',
      codeOffered: false
    });
  });

  it('writes no row when the caller proves itself', async () => {
    const token = await accessToken();

    const res = await post(
      '/auth/mfa/setup',
      { currentPassword: CREDENTIALS.password },
      token
    );

    expect(res.status).toBe(200);
    expect(failureRows()).toHaveLength(0);
  });
});
