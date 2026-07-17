import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { PASSWORD_ERROR } from '@app/shared/constants/password.constants';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import { createApp } from '../app';
import { resetState } from '../state';

let server: Server;
let baseUrl: string;

// Satisfies the min-length check but fails PASSWORD_REGEX (no uppercase).
const INVALID_PASSWORD = 'nouppercase1';

beforeAll((done) => {
  resetState();
  const app = createApp();
  server = app.listen(0, () => {
    const addr = server.address() as AddressInfo;
    baseUrl = `http://localhost:${addr.port}`;
    done();
  });
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

function authHeaders(token: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`
  };
}

describe('PATCH /api/v1/users/:id validates the whole body before mutating', () => {
  it('a 400 on the password regex leaves the other fields untouched', async () => {
    const token = await login('admin@example.com');

    const res = await fetch(`${baseUrl}/api/v1/users/3`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({
        firstName: 'Changed',
        email: 'changed@example.com',
        password: INVALID_PASSWORD
      })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe(PASSWORD_ERROR);

    const after = await fetch(`${baseUrl}/api/v1/users/3`, {
      headers: authHeaders(token)
    });
    const user = (await after.json()) as {
      firstName: string;
      email: string;
      isEmailVerified: boolean;
    };
    expect(user.firstName).toBe('John');
    expect(user.email).toBe('john@example.com');
    expect(user.isEmailVerified).toBe(true);
  });
});

describe('PATCH /api/v1/auth/profile validates the whole body before mutating', () => {
  it('a 400 on the password regex leaves the profile untouched', async () => {
    const token = await login('user@example.com');

    const res = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({
        firstName: 'Changed',
        locale: 'ru',
        password: INVALID_PASSWORD,
        currentPassword: 'Password1'
      })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe(PASSWORD_ERROR);

    const after = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      headers: authHeaders(token)
    });
    const profile = (await after.json()) as {
      firstName: string;
      locale: string;
    };
    expect(profile.firstName).toBe('Regular');
    expect(profile.locale).toBe('en');
  });

  it('reports the regex failure before the currentPassword check (DTO validation first)', async () => {
    const token = await login('user@example.com');

    const res = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({
        password: INVALID_PASSWORD,
        currentPassword: 'wrong-current'
      })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe(PASSWORD_ERROR);
  });
});

describe('DELETE /api/v1/roles/:id/permissions/:permissionId', () => {
  it('returns 404 for an unknown role', async () => {
    const token = await login('admin@example.com');

    const res = await fetch(
      `${baseUrl}/api/v1/roles/no-such-role/permissions/perm-1`,
      { method: 'DELETE', headers: authHeaders(token) }
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { errorKey: string };
    expect(body.errorKey).toBe(ErrorKeys.ROLES.NOT_FOUND);
  });

  it('still succeeds for an existing role', async () => {
    const token = await login('admin@example.com');

    const res = await fetch(
      `${baseUrl}/api/v1/roles/role-editor/permissions/perm-1`,
      { method: 'DELETE', headers: authHeaders(token) }
    );

    expect(res.status).toBe(200);
  });
});
