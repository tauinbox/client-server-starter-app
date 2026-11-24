import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';

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

async function call(
  token: string,
  {
    method,
    path,
    body,
    ifMatch
  }: { method: string; path: string; body?: unknown; ifMatch?: string }
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(ifMatch === undefined ? {} : { 'if-match': ifMatch })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

const MISSING_USER_ID = '11111111-2222-4333-8444-555555555555';

const userRule = (userIds: string[]) => ({
  effect: 'include',
  payload: { type: 'user', userIds }
});

// The server stores the members of a `user` rule as rows of the user, so an id
// with no user row refuses the write (FeatureFlagService, writeRuleMembers).
describe('a user rule names only existing users (parity)', () => {
  it('refuses a create with an unknown user and writes no flag', async () => {
    const admin = await login('admin@example.com');
    const [known] = [...getState().users.keys()];
    const res = await call(admin, {
      method: 'POST',
      path: '/admin/feature-flags',
      body: {
        key: 'members-unknown',
        rules: [userRule([known, MISSING_USER_ID])]
      }
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.FEATURE_FLAGS.UNKNOWN_RULE_USER
    });
    expect(
      getState()
        .featureFlags.values()
        .some((f) => f.key === 'members-unknown')
    ).toBe(false);
  });

  it('refuses an update with an unknown user after the version check', async () => {
    const admin = await login('admin@example.com');
    const [known] = [...getState().users.keys()];
    const created = await call(admin, {
      method: 'POST',
      path: '/admin/feature-flags',
      body: { key: 'members-update', rules: [userRule([known])] }
    });

    expect(created.status).toBe(201);
    const flag = (await created.json()) as { id: string };
    const stale = await call(admin, {
      method: 'PATCH',
      path: `/admin/feature-flags/${flag.id}`,
      body: { rules: [userRule([MISSING_USER_ID])] },
      ifMatch: '"99"'
    });

    expect(stale.status).toBe(412);

    const res = await call(admin, {
      method: 'PATCH',
      path: `/admin/feature-flags/${flag.id}`,
      body: { rules: [userRule([MISSING_USER_ID])] },
      ifMatch: '*'
    });

    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.FEATURE_FLAGS.UNKNOWN_RULE_USER
    });

    const after = await call(admin, {
      method: 'GET',
      path: `/admin/feature-flags/${flag.id}`
    });
    const body = (await after.json()) as {
      version: number;
      rules: { payload: unknown }[];
    };

    expect(body.version).toBe(1);
    expect(body.rules.map((r) => r.payload)).toEqual([
      { type: 'user', userIds: [known] }
    ]);
  });
});
