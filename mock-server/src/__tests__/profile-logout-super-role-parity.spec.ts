import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

let server: Server;
let baseUrl: string;

const ADMIN_EMAIL = 'admin@example.com';
const USER_EMAIL = 'user@example.com';
const PASSWORD = 'Password1';
const NEW_PASSWORD = 'Sunrise-Kettle-19';
const ADMIN_ROLE_ID = mockId('role-admin');
const USER_ROLE_ID = mockId('role-user');

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

afterEach(() => {
  delete process.env['MFA_REQUIRED_FOR_ADMINS'];
});

async function login(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

function send(
  token: string,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function userIdOf(email: string): string {
  const user = [...getState().users.values()].find((u) => u.email === email);
  if (!user) throw new Error(`Seed user ${email} is missing`);
  return user.id;
}

/** The cleared cookies of a response, as `name path` pairs. */
function clearedCookies(res: Response): string[] {
  return res.headers
    .getSetCookie()
    .filter((raw) => raw.includes('Expires=Thu, 01 Jan 1970'))
    .map((raw) => {
      const name = raw.slice(0, raw.indexOf('='));
      const path = /Path=([^;]+)/.exec(raw)?.[1] ?? '';
      return `${name} ${path}`;
    });
}

const SESSION_BOUND_COOKIES = [
  'refresh_token /',
  'oauth_link /',
  'oauth_reauth /',
  'reauth_proof /'
];

describe('PATCH /auth/profile', () => {
  it('rejects an empty first name', async () => {
    const token = await login(USER_EMAIL);

    const res = await send(token, 'PATCH', '/auth/profile', { firstName: '' });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors).toEqual(['firstName should not be empty']);
  });

  it('reports both name fields, and both rules for an explicit null', async () => {
    const token = await login(USER_EMAIL);

    const res = await send(token, 'PATCH', '/auth/profile', {
      firstName: null,
      lastName: ''
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors).toEqual([
      'firstName must be shorter than or equal to 255 characters',
      'firstName should not be empty',
      'lastName should not be empty'
    ]);
  });

  it('keeps an accepted name edit working', async () => {
    const token = await login(USER_EMAIL);

    const res = await send(token, 'PATCH', '/auth/profile', {
      firstName: 'Renamed'
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { firstName: string }).firstName).toBe(
      'Renamed'
    );
  });

  it('refuses a caller without update:Profile', async () => {
    const state = getState();
    const updateProfile = [...state.permissions.values()].find(
      (p) =>
        p.resourceId === mockId('res-profile') &&
        p.actionId === mockId('act-update')
    );
    expect(updateProfile).toBeDefined();
    state.rolePermissions = state.rolePermissions.filter(
      (rp) =>
        !(rp.roleId === USER_ROLE_ID && rp.permissionId === updateProfile?.id)
    );
    const token = await login(USER_EMAIL);

    const res = await send(token, 'PATCH', '/auth/profile', {
      firstName: 'Renamed'
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toBe(
      'Insufficient permissions'
    );
  });

  it('stays open to an account that owes a two-factor enrolment', async () => {
    process.env['MFA_REQUIRED_FOR_ADMINS'] = 'true';
    const token = await login(ADMIN_EMAIL);

    const gated = await send(token, 'GET', '/roles');
    const profile = await send(token, 'PATCH', '/auth/profile', {
      locale: 'en'
    });

    expect(gated.status).toBe(403);
    expect(profile.status).toBe(200);
  });

  it('clears every session-bound cookie on a password change', async () => {
    const token = await login(USER_EMAIL);

    const res = await send(token, 'PATCH', '/auth/profile', {
      password: NEW_PASSWORD,
      currentPassword: PASSWORD
    });

    expect(res.status).toBe(200);
    expect(clearedCookies(res)).toEqual(
      expect.arrayContaining(SESSION_BOUND_COOKIES)
    );
  });
});

describe('POST /auth/logout', () => {
  it('clears every session-bound cookie', async () => {
    const token = await login(USER_EMAIL);

    const res = await send(token, 'POST', '/auth/logout');

    expect(res.status).toBe(200);
    expect(clearedCookies(res)).toEqual(
      expect.arrayContaining(SESSION_BOUND_COOKIES)
    );
  });
});

describe('super role assignment', () => {
  it('refuses a super caller that assigns the super role', async () => {
    const token = await login(ADMIN_EMAIL);
    const userId = userIdOf(USER_EMAIL);

    const res = await send(token, 'POST', `/roles/assign/${userId}`, {
      roleId: ADMIN_ROLE_ID
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toBe(
      'Cannot assign super roles'
    );
    expect(getState().users.get(userId)?.roles).not.toContain('admin');
  });

  it('refuses a super caller that removes the super role', async () => {
    const token = await login(ADMIN_EMAIL);
    const adminId = userIdOf(ADMIN_EMAIL);

    const res = await send(
      token,
      'DELETE',
      `/roles/assign/${adminId}/${ADMIN_ROLE_ID}`
    );

    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toBe(
      'Cannot remove super roles'
    );
    expect(getState().users.get(adminId)?.roles).toContain('admin');
  });
});
