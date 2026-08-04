import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

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

// The mock enforced three rules no server DTO has and skipped the checks the
// DTOs do run. Every expectation below is the observed behaviour of the real
// ValidationPipe against CreateActionDto / UpdateActionDto / UpdateResourceDto.
describe('rbac validation parity with server', () => {
  describe('POST /rbac/actions', () => {
    it('accepts a name the DTO only lowercases and trims', async () => {
      const res = await send('POST', '/rbac/actions', {
        name: 'Publish Post',
        displayName: 'Publish',
        description: 'Publish a record'
      });

      expect(res.status).toBe(201);
      const action = (await res.json()) as { name: string };
      expect(action.name).toBe('publish post');
    });

    it('creates an action with no description', async () => {
      const res = await send('POST', '/rbac/actions', {
        name: 'publish',
        displayName: 'Publish'
      });

      expect(res.status).toBe(201);
      const action = (await res.json()) as { description: string };
      expect(action.description).toBe('');
    });

    it('rejects a non-string description', async () => {
      const res = await send('POST', '/rbac/actions', {
        name: 'publish',
        displayName: 'Publish',
        description: 42
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors?: string[] };
      expect(body.errors).toEqual(['description must be a string']);
    });

    it('still rejects a reserved name with the service envelope', async () => {
      const res = await send('POST', '/rbac/actions', {
        name: 'manage',
        displayName: 'Manage',
        description: 'd'
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors?: string[] };
      expect(body.errors).toBeUndefined();
    });
  });

  describe('PATCH /rbac/actions/:id', () => {
    it('accepts a whitespace-only displayName', async () => {
      const res = await send('PATCH', '/rbac/actions/act-assign', {
        displayName: '   '
      });

      expect(res.status).toBe(200);
      const action = (await res.json()) as { displayName: string };
      expect(action.displayName).toBe('   ');
    });

    it('rejects a non-string displayName', async () => {
      const res = await send('PATCH', '/rbac/actions/act-assign', {
        displayName: 7
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors?: string[] };
      expect(body.errors).toEqual(['displayName must be a string']);
    });

    it('rejects a non-string description without mutating the action', async () => {
      const res = await send('PATCH', '/rbac/actions/act-assign', {
        displayName: 'Assign records',
        description: { nested: true }
      });

      expect(res.status).toBe(400);

      const after = await send('PATCH', '/rbac/actions/act-assign', {});
      const action = (await after.json()) as { displayName: string };
      expect(action.displayName).toBe('Assign');
    });
  });

  describe('PATCH /rbac/resources/:id', () => {
    it('accepts a whitespace-only displayName', async () => {
      const res = await send('PATCH', '/rbac/resources/res-users', {
        displayName: '  '
      });

      expect(res.status).toBe(200);
      const resource = (await res.json()) as { displayName: string };
      expect(resource.displayName).toBe('  ');
    });

    it('rejects a non-string displayName', async () => {
      const res = await send('PATCH', '/rbac/resources/res-users', {
        displayName: []
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors?: string[] };
      expect(body.errors).toEqual(['displayName must be a string']);
    });

    it('rejects an over-long description without mutating the resource', async () => {
      const res = await send('PATCH', '/rbac/resources/res-users', {
        displayName: 'Renamed',
        description: 'x'.repeat(501)
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors?: string[] };
      expect(body.errors).toEqual([
        'description must not exceed 500 characters'
      ]);

      const after = await send('PATCH', '/rbac/resources/res-users', {});
      const resource = (await after.json()) as { displayName: string };
      expect(resource.displayName).not.toBe('Renamed');
    });

    it('accepts a null description', async () => {
      const res = await send('PATCH', '/rbac/resources/res-users', {
        description: null
      });

      expect(res.status).toBe(200);
    });
  });
});
