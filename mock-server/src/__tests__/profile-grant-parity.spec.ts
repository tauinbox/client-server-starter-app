import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockUser } from '../types';

let server: Server;
let baseUrl: string;

const NO_ROLE_ID = '901';
const NO_ROLE_EMAIL = 'no-role@example.com';

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

function seededUser(): MockUser {
  return [...getState().users.values()].find(
    (u) => u.email === 'user@example.com'
  ) as MockUser;
}

function seedUserWithNoRole(): void {
  getState().users.set(NO_ROLE_ID, {
    ...seededUser(),
    id: NO_ROLE_ID,
    email: NO_ROLE_EMAIL,
    roles: []
  });
}

async function accessToken(userId: string): Promise<string> {
  const dataRes = await fetch(`${baseUrl}/__control/oauth-data`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId })
  });
  expect(dataRes.status).toBe(200);
  const { token } = (await dataRes.json()) as { token: string };

  const exchange = await fetch(`${baseUrl}/api/v1/auth/oauth/exchange`, {
    method: 'POST',
    headers: { cookie: `oauth_data=${token}` }
  });
  expect(exchange.status).toBe(200);
  const body = (await exchange.json()) as {
    tokens: { access_token: string };
  };
  return body.tokens.access_token;
}

function initiateEmailChange(token: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/profile/email/initiate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      newEmail: 'moved-address@example.com',
      currentPassword: 'Password1'
    })
  });
}

describe('POST /api/v1/auth/profile/email/initiate needs update:Profile', () => {
  it('refuses an account whose roles do not grant update:Profile', async () => {
    seedUserWithNoRole();
    const token = await accessToken(NO_ROLE_ID);

    const res = await initiateEmailChange(token);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.GENERAL.INSUFFICIENT_PERMISSIONS
    });
    expect(getState().users.get(NO_ROLE_ID)?.pendingEmail).toBeFalsy();
  });

  it('accepts an account that holds the grant', async () => {
    const user = seededUser();
    const token = await accessToken(user.id);

    const res = await initiateEmailChange(token);

    expect(res.status).toBe(200);
    expect(getState().users.get(user.id)?.pendingEmail).toBe(
      'moved-address@example.com'
    );
  });
});
