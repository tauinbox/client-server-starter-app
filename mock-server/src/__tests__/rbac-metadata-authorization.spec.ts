import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp } from '../app';
import { resetState } from '../state';

let server: Server;
let baseUrl: string;

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

// Parity with the server: GET /rbac/metadata is gated by `read Permission`
// like its sibling read endpoints, not just by authentication.
describe('GET /api/v1/rbac/metadata authorization', () => {
  it('returns 403 for a basic authenticated user', async () => {
    const token = await login('user@example.com');

    const res = await fetch(`${baseUrl}/api/v1/rbac/metadata`, {
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.status).toBe(403);
  });

  it('returns the catalog for an authorized admin', async () => {
    const token = await login('admin@example.com');

    const res = await fetch(`${baseUrl}/api/v1/rbac/metadata`, {
      headers: { authorization: `Bearer ${token}` }
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resources: unknown[];
      actions: unknown[];
    };
    expect(Array.isArray(body.resources)).toBe(true);
    expect(Array.isArray(body.actions)).toBe(true);
    expect(body.resources.length).toBeGreaterThan(0);
    expect(body.actions.length).toBeGreaterThan(0);
  });
});
