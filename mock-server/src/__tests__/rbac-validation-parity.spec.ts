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
  describe('PATCH /rbac/resources/:id', () => {
    it('accepts a whitespace-only displayName', async () => {
      const res = await send(
        'PATCH',
        `/rbac/resources/${mockId('res-users')}`,
        {
          displayName: '  '
        }
      );

      expect(res.status).toBe(200);
      const resource = (await res.json()) as { displayName: string };
      expect(resource.displayName).toBe('  ');
    });

    it('rejects a non-string displayName', async () => {
      const res = await send(
        'PATCH',
        `/rbac/resources/${mockId('res-users')}`,
        {
          displayName: []
        }
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors?: string[] };
      expect(body.errors).toEqual([
        'displayName must be shorter than or equal to 100 characters',
        'displayName must be a string'
      ]);
    });

    it('rejects an over-long description without mutating the resource', async () => {
      const res = await send(
        'PATCH',
        `/rbac/resources/${mockId('res-users')}`,
        {
          displayName: 'Renamed',
          description: 'x'.repeat(501)
        }
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors?: string[] };
      expect(body.errors).toEqual([
        'description must be shorter than or equal to 500 characters'
      ]);

      const after = await send(
        'PATCH',
        `/rbac/resources/${mockId('res-users')}`,
        {}
      );
      const resource = (await after.json()) as { displayName: string };
      expect(resource.displayName).not.toBe('Renamed');
    });

    it('rejects an unknown property', async () => {
      const res = await send(
        'PATCH',
        `/rbac/resources/${mockId('res-users')}`,
        { bogus: 1, other: 2, displayName: 'ok' }
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors?: string[] };
      expect(body.errors).toEqual([
        'property bogus should not exist',
        'property other should not exist'
      ]);
    });

    it('reports every fault of a body at once, in DTO order', async () => {
      const res = await send(
        'PATCH',
        `/rbac/resources/${mockId('res-users')}`,
        {
          bogus: 1,
          displayName: 'd'.repeat(101),
          description: 501,
          allowedActionNames: 5
        }
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors?: string[] };
      expect(body.errors).toEqual([
        'property bogus should not exist',
        'displayName must be shorter than or equal to 100 characters',
        'description must be shorter than or equal to 500 characters',
        'description must be a string',
        'each value in allowedActionNames must be shorter than or equal to 50 characters',
        'each value in allowedActionNames must be a string',
        'allowedActionNames must contain no more than 100 elements',
        'allowedActionNames must be an array'
      ]);
    });

    it('reports the four allowedActionNames constraints bottom-up', async () => {
      const res = await send(
        'PATCH',
        `/rbac/resources/${mockId('res-users')}`,
        { allowedActionNames: [1, 'x'.repeat(51)] }
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors?: string[] };
      expect(body.errors).toEqual([
        'each value in allowedActionNames must be shorter than or equal to 50 characters',
        'each value in allowedActionNames must be a string'
      ]);
    });

    it('reports displayName ahead of allowedActionNames', async () => {
      const res = await send(
        'PATCH',
        `/rbac/resources/${mockId('res-users')}`,
        { allowedActionNames: ['read', 'x'.repeat(51)], displayName: 5 }
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors?: string[] };
      expect(body.errors).toEqual([
        'displayName must be shorter than or equal to 100 characters',
        'displayName must be a string',
        'each value in allowedActionNames must be shorter than or equal to 50 characters'
      ]);
    });

    it('accepts a null allowedActionNames', async () => {
      const res = await send(
        'PATCH',
        `/rbac/resources/${mockId('res-users')}`,
        { allowedActionNames: null }
      );

      expect(res.status).toBe(200);
    });

    it('accepts a null description', async () => {
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
});
