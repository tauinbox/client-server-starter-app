import type { Server } from 'http';
import { MAX_PAGE_SIZE } from '@app/shared/constants';
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

async function loginAdmin(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

function get(token: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: { authorization: `Bearer ${token}` }
  });
}

const OFFSET_ROUTES = ['/api/v1/users', '/api/v1/users/search'];
const CURSOR_ROUTES = ['/api/v1/users/cursor', '/api/v1/users/search/cursor'];
const ALL_ROUTES = [...OFFSET_ROUTES, ...CURSOR_ROUTES];

/**
 * The mock used to clamp an oversized `limit` and answer 200 while the server
 * rejects it through `@Max(MAX_PAGE_SIZE)` on the shared DTO. A laxer mock lets
 * a regression pass the E2E suite, so the boundary is asserted on every route.
 */
describe('user list routes reject out-of-range paging like the server', () => {
  it.each(ALL_ROUTES)('rejects limit above the maximum on %s', async (path) => {
    const token = await loginAdmin();

    const res = await get(token, `${path}?limit=${MAX_PAGE_SIZE + 1}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors).toContain(
      `limit must not be greater than ${MAX_PAGE_SIZE}`
    );
  });

  it.each(ALL_ROUTES)('rejects limit below 1 on %s', async (path) => {
    const token = await loginAdmin();

    const res = await get(token, `${path}?limit=0`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors).toContain('limit must not be less than 1');
  });

  it.each(ALL_ROUTES)('accepts the maximum itself on %s', async (path) => {
    const token = await loginAdmin();

    const res = await get(token, `${path}?limit=${MAX_PAGE_SIZE}`);
    expect(res.status).toBe(200);
  });

  it.each(OFFSET_ROUTES)('rejects page below 1 on %s', async (path) => {
    const token = await loginAdmin();

    const res = await get(token, `${path}?page=0`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors).toContain('page must not be less than 1');
  });

  it.each(ALL_ROUTES)(
    'rejects a sortBy outside the whitelist on %s',
    async (path) => {
      const token = await loginAdmin();

      const res = await get(token, `${path}?sortBy=password`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors: string[] };
      expect(body.errors[0]).toContain('sortBy must be one of');
    }
  );

  it('still accepts the documented filters alongside paging', async () => {
    const token = await loginAdmin();

    const res = await get(
      token,
      '/api/v1/users/search?q=admin&isActive=true&limit=5&page=1'
    );
    expect(res.status).toBe(200);
  });
});
