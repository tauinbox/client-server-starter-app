import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
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
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function send(
  method: string,
  path: string,
  body: unknown
): Promise<Response> {
  const token = await loginAsAdmin();
  return fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

async function expectValidation400(
  method: string,
  path: string,
  body: unknown
): Promise<void> {
  const res = await send(method, path, body);
  expect(res.status).toBe(400);
  const payload = (await res.json()) as { errors?: string[] };
  expect(payload.errors).toBeDefined();
}

// The server DTOs replaced @IsOptional() with a defined-only condition (or
// PartialType's skipNullProperties) on every optional field whose column is NOT
// NULL, so an explicit null is a 400 instead of a NOT NULL violation - and, for
// password, instead of a silently wiped credential.
describe('explicit null parity with server DTOs', () => {
  describe('PATCH /roles/:id', () => {
    it('rejects a null name', async () => {
      await expectValidation400('PATCH', `/roles/${mockId('role-editor')}`, {
        name: null
      });
    });

    it('rejects a non-string and an over-long name', async () => {
      await expectValidation400('PATCH', `/roles/${mockId('role-editor')}`, {
        name: 7
      });
      await expectValidation400('PATCH', `/roles/${mockId('role-editor')}`, {
        name: 'x'.repeat(101)
      });
    });

    it('rejects a whitespace-only name, which CreateRoleDto trims to empty', async () => {
      await expectValidation400('PATCH', `/roles/${mockId('role-editor')}`, {
        name: '   '
      });
    });

    it('trims an accepted name and leaves a null description legal', async () => {
      const res = await send('PATCH', `/roles/${mockId('role-editor')}`, {
        name: '  content-editor  ',
        description: null
      });

      expect(res.status).toBe(200);
      const role = (await res.json()) as {
        name: string;
        description: string | null;
      };
      expect(role.name).toBe('content-editor');
      expect(role.description).toBeNull();
    });
  });

  describe('PATCH /rbac/actions/:id', () => {
    it('rejects a null displayName and a null description', async () => {
      await expectValidation400(
        'PATCH',
        `/rbac/actions/${mockId('act-assign')}`,
        {
          displayName: null
        }
      );
      await expectValidation400(
        'PATCH',
        `/rbac/actions/${mockId('act-assign')}`,
        {
          description: null
        }
      );
    });
  });

  describe('PATCH /rbac/resources/:id', () => {
    it('keeps accepting a null description, whose column is nullable', async () => {
      const res = await send(
        'PATCH',
        `/rbac/resources/${mockId('res-users')}`,
        {
          description: null
        }
      );

      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /users/:id', () => {
    it.each(['email', 'firstName', 'lastName', 'password', 'locale'])(
      'rejects a null %s',
      async (field) => {
        await expectValidation400('PATCH', `/users/${mockId('user-3')}`, {
          [field]: null
        });
      }
    );

    it('leaves the target untouched after a rejected null', async () => {
      const before = getState().users.get(mockId('user-3'));
      const firstName = before?.firstName;

      await expectValidation400('PATCH', `/users/${mockId('user-3')}`, {
        firstName: null
      });

      expect(getState().users.get(mockId('user-3'))?.firstName).toBe(firstName);
    });

    it('applies a locale the server DTO also accepts', async () => {
      const res = await send('PATCH', `/users/${mockId('user-3')}`, {
        locale: 'ru'
      });

      expect(res.status).toBe(200);
      expect(getState().users.get(mockId('user-3'))?.locale).toBe('ru');
    });

    it('rejects an unsupported locale', async () => {
      await expectValidation400('PATCH', `/users/${mockId('user-3')}`, {
        locale: 'xx'
      });
    });
  });

  describe('PATCH /auth/profile', () => {
    it.each(['firstName', 'lastName', 'locale'])(
      'rejects a null %s',
      async (field) => {
        await expectValidation400('PATCH', '/auth/profile', { [field]: null });
      }
    );

    it('rejects a null password instead of wiping the credential', async () => {
      const token = await loginAsAdmin();
      const res = await fetch(`${baseUrl}/api/v1/auth/profile`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ password: null, currentPassword: 'Password1' })
      });

      expect(res.status).toBe(400);
      const admin = Array.from(getState().users.values()).find(
        (u) => u.email === 'admin@example.com'
      );
      expect(admin?.password).toBe('Password1');
    });
  });
});
