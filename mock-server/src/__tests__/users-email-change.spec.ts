import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';
import { mockId } from '../utils/mock-id';

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

async function loginAsAdmin(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@example.com',
      password: 'Password1'
    })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function loginAsUser(
  email: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  const setCookie = res.headers.get('set-cookie') ?? '';
  const refreshToken = /refresh_token=([^;]+)/.exec(setCookie)?.[1] ?? '';
  expect(refreshToken).not.toBe('');
  return { accessToken: body.tokens.access_token, refreshToken };
}

describe('PATCH /api/v1/users/:id email-change parity with server', () => {
  it('returns 409 with errorKey + field on duplicate email', async () => {
    const token = await loginAsAdmin();

    // user '3' (john@example.com) trying to take user '5' (bob@example.com)
    const res = await fetch(`${baseUrl}/api/v1/users/${mockId('user-3')}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ email: 'bob@example.com' })
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      errorKey: string;
      field?: string;
      message: string;
    };
    expect(body.errorKey).toBe('errors.users.emailExists');
    // The server envelope is closed and never carried this key on the wire.
    expect(body.field).toBeUndefined();
  });

  it('resets isEmailVerified when email changes', async () => {
    const token = await loginAsAdmin();

    const res = await fetch(`${baseUrl}/api/v1/users/${mockId('user-3')}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ email: 'changed@example.com' })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      email: string;
      isEmailVerified: boolean;
    };
    expect(body.email).toBe('changed@example.com');
    expect(body.isEmailVerified).toBe(false);
  });

  it('revokes the target sessions when the admin changes the email', async () => {
    const victim = await loginAsUser('john@example.com');
    const adminToken = await loginAsAdmin();

    const res = await fetch(`${baseUrl}/api/v1/users/${mockId('user-3')}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ email: 'moved@example.com' })
    });
    expect(res.status).toBe(200);

    const profile = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      headers: { authorization: `Bearer ${victim.accessToken}` }
    });
    expect(profile.status).toBe(401);

    const refreshed = await fetch(`${baseUrl}/api/v1/auth/refresh-token`, {
      method: 'POST',
      headers: { cookie: `refresh_token=${victim.refreshToken}` }
    });
    expect(refreshed.status).toBe(401);
  });

  it('leaves the target sessions alive when the email is unchanged', async () => {
    const victim = await loginAsUser('john@example.com');
    const adminToken = await loginAsAdmin();

    const res = await fetch(`${baseUrl}/api/v1/users/${mockId('user-3')}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ email: 'john@example.com', firstName: 'Johnny' })
    });
    expect(res.status).toBe(200);

    const profile = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      headers: { authorization: `Bearer ${victim.accessToken}` }
    });
    expect(profile.status).toBe(200);
  });

  it('does not reset isEmailVerified when email is unchanged', async () => {
    const token = await loginAsAdmin();

    const res = await fetch(`${baseUrl}/api/v1/users/${mockId('user-3')}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ email: 'john@example.com', firstName: 'Johnny' })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { isEmailVerified: boolean };
    expect(body.isEmailVerified).toBe(true);
  });
});
