import type { Server } from 'http';
import { STEP_UP_OPERATION } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import {
  addOAuthAccounts,
  findUserByEmail,
  getState,
  resetState
} from '../state';

let server: Server;
let baseUrl: string;

const USER_EMAIL = 'user@example.com';
const ADMIN_EMAIL = 'admin@example.com';
const SEED_PASSWORD = 'Password1';
const NEW_PASSWORD = 'Recovered-Kestrel-42';

beforeAll(async () => {
  resetState();
  const app = createApp();
  server = await listenOnUnblockedPort(app);
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

let userId: string;

beforeEach(() => {
  resetState();
  userId = findUserByEmail(USER_EMAIL)!.id;
  addOAuthAccounts(userId, [
    {
      provider: 'google',
      providerId: 'google-intruder',
      createdAt: new Date().toISOString()
    }
  ]);
});

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

async function adminToken(): Promise<string> {
  const res = await post('auth/login', {
    email: ADMIN_EMAIL,
    password: SEED_PASSWORD
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function patchUser(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${baseUrl}/api/v1/users/${userId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await adminToken()}`
    },
    body: JSON.stringify(body)
  });
  expect(res.status).toBe(200);
}

function unlinkRows(): unknown[] {
  return getState().auditLogs.filter((row) => row.action === 'OAUTH_UNLINK');
}

describe('account recovery removes the linked providers', () => {
  it('a password reset removes them and audits each', async () => {
    expect(
      (await post('auth/forgot-password', { email: USER_EMAIL })).status
    ).toBe(200);
    const [token] = [...getState().passwordResetTokens.keys()];

    const res = await post('auth/reset-password', {
      token,
      password: NEW_PASSWORD
    });
    expect(res.status).toBe(200);

    expect(getState().oauthAccounts.get(userId) ?? []).toHaveLength(0);
    expect(unlinkRows()).toEqual([
      expect.objectContaining({
        actorId: userId,
        targetId: userId,
        details: { provider: 'google', source: 'password_reset' }
      })
    ]);
  });

  it('an administrator password change removes them', async () => {
    await patchUser({ password: NEW_PASSWORD, currentPassword: SEED_PASSWORD });

    expect(getState().oauthAccounts.get(userId) ?? []).toHaveLength(0);
    expect(unlinkRows()).toEqual([
      expect.objectContaining({
        actorEmail: ADMIN_EMAIL,
        details: { provider: 'google', source: 'admin' }
      })
    ]);
  });

  it('an administrator email change removes them', async () => {
    await patchUser({
      email: 'recovered-owner@example.com',
      currentPassword: SEED_PASSWORD
    });

    expect(getState().oauthAccounts.get(userId) ?? []).toHaveLength(0);
  });

  it('a profile password change removes them only when the owner asks', async () => {
    const userToken = async (): Promise<string> => {
      const res = await post('auth/login', {
        email: USER_EMAIL,
        password: SEED_PASSWORD
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { tokens: { access_token: string } }).tokens
        .access_token;
    };
    const patchProfile = async (body: Record<string, unknown>) =>
      fetch(`${baseUrl}/api/v1/auth/profile`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await userToken()}`
        },
        body: JSON.stringify(body)
      });

    const kept = await patchProfile({
      password: NEW_PASSWORD,
      currentPassword: SEED_PASSWORD
    });
    expect(kept.status).toBe(200);
    expect(getState().oauthAccounts.get(userId)).toHaveLength(1);

    findUserByEmail(USER_EMAIL)!.password = SEED_PASSWORD;
    const removed = await patchProfile({
      password: NEW_PASSWORD,
      currentPassword: SEED_PASSWORD,
      removeLinkedProviders: true
    });
    expect(removed.status).toBe(200);
    expect(getState().oauthAccounts.get(userId) ?? []).toHaveLength(0);
    expect(unlinkRows()).toEqual([
      expect.objectContaining({
        actorId: userId,
        details: { provider: 'google', source: 'self' }
      })
    ]);
  });

  it('a first password keeps them even when asked', async () => {
    findUserByEmail(USER_EMAIL)!.password = null;
    const data = await post('../../__control/oauth-data', { userId });
    const { token } = (await data.json()) as { token: string };
    const exchange = await fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
      method: 'POST',
      headers: { cookie: `oauth_data=${token}` }
    });
    const access = (
      (await exchange.json()) as { tokens: { access_token: string } }
    ).tokens.access_token;
    const proofRes = await post('../../__control/reauth-proof', {
      userId,
      operation: STEP_UP_OPERATION.PASSWORD_SET
    });
    const { token: proof } = (await proofRes.json()) as { token: string };

    const res = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${access}`,
        cookie: `reauth_proof=${proof}`
      },
      body: JSON.stringify({
        password: NEW_PASSWORD,
        removeLinkedProviders: true
      })
    });

    expect(res.status).toBe(200);
    expect(getState().oauthAccounts.get(userId)).toHaveLength(1);
  });

  it('refuses a removeLinkedProviders that is not a boolean', async () => {
    const login = await post('auth/login', {
      email: USER_EMAIL,
      password: SEED_PASSWORD
    });
    const access = (
      (await login.json()) as { tokens: { access_token: string } }
    ).tokens.access_token;

    const res = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${access}`
      },
      body: JSON.stringify({ name: 'x', removeLinkedProviders: 'yes' })
    });

    expect(res.status).toBe(422);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      'removeLinkedProviders must be a boolean value'
    ]);
  });

  it('a deactivation or a name edit keeps them', async () => {
    await patchUser({ isActive: false, name: 'Renamed' });

    expect(getState().oauthAccounts.get(userId)).toHaveLength(1);
    expect(unlinkRows()).toHaveLength(0);
  });
});
