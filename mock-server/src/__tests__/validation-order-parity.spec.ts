import type { Server } from 'http';
import { ErrorKeys, MIN_PASSWORD_LENGTH } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';
import { mockId } from '../utils/mock-id';

let server: Server;
let baseUrl: string;

// Fails the `@MinLength` the password field still carries, which is the
// remaining DTO-level password validator now the composition regex is gone.
const INVALID_PASSWORD = 'short';
const PASSWORD_LENGTH_ERROR = `password must be longer than or equal to ${MIN_PASSWORD_LENGTH} characters`;

// Seeded into the mock breach corpus, so the blocklist refuses it.
const BREACHED_PASSWORD = 'Password1';

async function seedBreached(baseUrl: string, values: string[]): Promise<void> {
  const res = await fetch(`${baseUrl}/__control/breached-passwords`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(values)
  });
  expect(res.status).toBe(200);
}

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

function authHeaders(token: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`
  };
}

describe('PATCH /api/v1/users/:id validates the whole body before mutating', () => {
  it('a 400 on the password length leaves the other fields untouched', async () => {
    const token = await login('admin@example.com');

    const res = await fetch(`${baseUrl}/api/v1/users/${mockId('user-3')}`, {
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
    expect(body.message).toBe(PASSWORD_LENGTH_ERROR);

    const after = await fetch(`${baseUrl}/api/v1/users/${mockId('user-3')}`, {
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
  it('a 400 on the password length leaves the profile untouched', async () => {
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
    expect(body.message).toBe(PASSWORD_LENGTH_ERROR);

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

  it('reports the length failure before the currentPassword check (DTO validation first)', async () => {
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
    expect(body.message).toBe(PASSWORD_LENGTH_ERROR);
  });
});

describe('the breach blocklist mirrors the server verdict', () => {
  it('refuses a listed password on the admin update and leaves the row untouched', async () => {
    const token = await login('admin@example.com');

    const res = await fetch(`${baseUrl}/api/v1/users/${mockId('user-3')}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({
        firstName: 'Changed',
        password: BREACHED_PASSWORD
      })
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message:
        'This password has appeared in a public data breach. Please choose a different one.',
      statusCode: 400,
      errorKey: ErrorKeys.AUTH.PASSWORD_BREACHED
    });

    const after = await fetch(`${baseUrl}/api/v1/users/${mockId('user-3')}`, {
      headers: authHeaders(token)
    });
    const user = (await after.json()) as { firstName: string };
    expect(user.firstName).toBe('John');
  });

  it('refuses a listed password on the profile update and leaves it untouched', async () => {
    const token = await login('user@example.com');

    const res = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({
        firstName: 'Changed',
        password: BREACHED_PASSWORD,
        currentPassword: 'Password1'
      })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { errorKey: string };
    expect(body.errorKey).toBe(ErrorKeys.AUTH.PASSWORD_BREACHED);

    const after = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      headers: authHeaders(token)
    });
    const profile = (await after.json()) as { firstName: string };
    expect(profile.firstName).toBe('Regular');
  });

  it('reports a wrong currentPassword before the blocklist verdict', async () => {
    const token = await login('user@example.com');

    const res = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({
        password: BREACHED_PASSWORD,
        currentPassword: 'wrong-current'
      })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { errorKey: string };
    expect(body.errorKey).toBe(ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD);
  });

  it('refuses a listed password on register, ahead of the address conflict', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        firstName: 'Taken',
        lastName: 'Address',
        password: BREACHED_PASSWORD
      })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { errorKey: string };
    expect(body.errorKey).toBe(ErrorKeys.AUTH.PASSWORD_BREACHED);
  });

  it('reports an invalid reset token before the blocklist verdict', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'no-such-token',
        password: BREACHED_PASSWORD
      })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { errorKey: string };
    expect(body.errorKey).toBe(ErrorKeys.AUTH.INVALID_RESET_TOKEN);
  });

  it('refuses a value a test seeds through the control route', async () => {
    const password = 'Sunrise-Kettle-19';

    const accepted = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'seeded-clean@example.com',
        firstName: 'Clean',
        lastName: 'Value',
        password
      })
    });
    expect(accepted.status).toBe(201);

    await seedBreached(baseUrl, [password]);

    const refused = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'seeded-breached@example.com',
        firstName: 'Seeded',
        lastName: 'Value',
        password
      })
    });

    expect(refused.status).toBe(400);
    const body = (await refused.json()) as { errorKey: string };
    expect(body.errorKey).toBe(ErrorKeys.AUTH.PASSWORD_BREACHED);
  });

  it('accepts a password made only of lower-case letters', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'lowercase-only@example.com',
        firstName: 'Lower',
        lastName: 'Case',
        password: 'kettlesunrise'
      })
    });

    expect(res.status).toBe(201);
  });
});

// The server's global ValidationPipe runs before the handler, so a body that
// fails its DTO is a 400 regardless of whether the addressed row exists. Every
// handler below therefore has to answer 400 on a malformed body against an
// unknown id, and keep answering 404 once the body is well-formed.
describe('body validation precedes the entity lookup', () => {
  const UNKNOWN = mockId('no-such-row');

  interface Case {
    name: string;
    method: string;
    path: string;
    malformed: unknown;
    malformedMessage: string;
    wellFormed: unknown;
    notFoundKey?: string;
  }

  const cases: Case[] = [
    {
      name: 'PATCH /users/:id',
      method: 'PATCH',
      path: `/api/v1/users/${UNKNOWN}`,
      malformed: { password: INVALID_PASSWORD },
      malformedMessage: PASSWORD_LENGTH_ERROR,
      wellFormed: { firstName: 'Valid' },
      notFoundKey: ErrorKeys.USERS.NOT_FOUND
    },
    {
      name: 'PATCH /roles/:id',
      method: 'PATCH',
      path: `/api/v1/roles/${UNKNOWN}`,
      malformed: { name: '   ' },
      malformedMessage: 'name should not be empty',
      wellFormed: { name: 'valid-role-name' },
      notFoundKey: ErrorKeys.ROLES.NOT_FOUND
    },
    {
      name: 'PUT /roles/:id/permissions',
      method: 'PUT',
      path: `/api/v1/roles/${UNKNOWN}/permissions`,
      malformed: { items: 'not-an-array' },
      malformedMessage: 'items must be an array',
      wellFormed: { items: [] },
      notFoundKey: ErrorKeys.ROLES.NOT_FOUND
    },
    {
      name: 'POST /roles/:id/permissions',
      method: 'POST',
      path: `/api/v1/roles/${UNKNOWN}/permissions`,
      malformed: { permissionIds: [] },
      malformedMessage: 'permissionIds should not be empty',
      wellFormed: { permissionIds: [mockId('perm-1')] },
      notFoundKey: ErrorKeys.ROLES.NOT_FOUND
    },
    {
      name: 'PATCH /rbac/resources/:id',
      method: 'PATCH',
      path: `/api/v1/rbac/resources/${UNKNOWN}`,
      malformed: { displayName: 42 },
      malformedMessage:
        'displayName must be shorter than or equal to 100 characters. displayName must be a string',
      wellFormed: { displayName: 'Valid' },
      notFoundKey: ErrorKeys.RESOURCES.NOT_FOUND
    },
    {
      name: 'PATCH /rbac/actions/:id',
      method: 'PATCH',
      path: `/api/v1/rbac/actions/${UNKNOWN}`,
      malformed: { description: 'x'.repeat(501) },
      malformedMessage:
        'description must be shorter than or equal to 500 characters',
      wellFormed: { description: 'Valid' },
      notFoundKey: ErrorKeys.GENERAL.RESOURCE_NOT_FOUND
    },
    {
      name: 'POST /admin/billing/invoices/:id/refund',
      method: 'POST',
      path: `/api/v1/admin/billing/invoices/${UNKNOWN}/refund`,
      malformed: { amountMinor: 0 },
      malformedMessage: 'amountMinor must not be less than 1',
      wellFormed: { amountMinor: 500 }
    }
  ];

  it.each(cases)(
    '$name returns 400 on a malformed body against an unknown id',
    async ({ method, path, malformed, malformedMessage }) => {
      const token = await login('admin@example.com');

      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: authHeaders(token),
        body: JSON.stringify(malformed)
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe(malformedMessage);
    }
  );

  it.each(cases)(
    '$name still returns 404 on a well-formed body against an unknown id',
    async ({ method, path, wellFormed, notFoundKey }) => {
      const token = await login('admin@example.com');

      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: authHeaders(token),
        body: JSON.stringify(wellFormed)
      });

      expect(res.status).toBe(404);
      if (notFoundKey) {
        const body = (await res.json()) as { errorKey: string };
        expect(body.errorKey).toBe(notFoundKey);
      }
    }
  );

  it('PATCH /roles/:id rejects isSuper before the lookup', async () => {
    const token = await login('admin@example.com');

    const res = await fetch(`${baseUrl}/api/v1/roles/${UNKNOWN}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ isSuper: true })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { errorKey: string };
    expect(body.errorKey).toBe(ErrorKeys.ROLES.SUPER_FLAG_FORBIDDEN);
  });

  it('an existing row is still mutated by a well-formed body', async () => {
    const token = await login('admin@example.com');

    const res = await fetch(`${baseUrl}/api/v1/users/${mockId('user-3')}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ firstName: 'Renamed' })
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { firstName: string };
    expect(body.firstName).toBe('Renamed');
  });
});

describe('DELETE /api/v1/roles/:id/permissions/:permissionId', () => {
  it('returns 404 for an unknown role', async () => {
    const token = await login('admin@example.com');

    const res = await fetch(
      `${baseUrl}/api/v1/roles/${mockId('no-such-role')}/permissions/${mockId('perm-1')}`,
      { method: 'DELETE', headers: authHeaders(token) }
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { errorKey: string };
    expect(body.errorKey).toBe(ErrorKeys.ROLES.NOT_FOUND);
  });

  it('still succeeds for an existing role', async () => {
    const token = await login('admin@example.com');

    const res = await fetch(
      `${baseUrl}/api/v1/roles/${mockId('role-editor')}/permissions/${mockId('perm-1')}`,
      { method: 'DELETE', headers: authHeaders(token) }
    );

    expect(res.status).toBe(200);
  });
});
