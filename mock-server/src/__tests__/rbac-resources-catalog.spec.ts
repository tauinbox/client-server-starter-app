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

// Parity with the server: the catalog is gated by `read Permission` like its
// sibling read endpoints, and `ResourceService.findAll` orders it by name.
describe('GET /api/v1/rbac/resources', () => {
  it('returns 403 for a basic authenticated user', async () => {
    const token = await login('user@example.com');

    const res = await fetch(`${baseUrl}/api/v1/rbac/resources`, {
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.status).toBe(403);
  });

  it('returns the catalog sorted by name for an authorized admin', async () => {
    const token = await login('admin@example.com');

    const res = await fetch(`${baseUrl}/api/v1/rbac/resources`, {
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.status).toBe(200);
    const names = ((await res.json()) as { name: string }[]).map((r) => r.name);
    expect(names).toEqual([
      'billing',
      'feature-flags',
      'permissions',
      'profile',
      'roles',
      'users'
    ]);
  });

  it('has no /rbac/metadata sibling', async () => {
    const token = await login('admin@example.com');

    const res = await fetch(`${baseUrl}/api/v1/rbac/metadata`, {
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.status).toBe(404);
  });
});
