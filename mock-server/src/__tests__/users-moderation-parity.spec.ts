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

async function patchUser(
  token: string,
  id: string,
  payload: unknown
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/users/${id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });
}

describe('PATCH /api/v1/users/:id moderation-field parity with server', () => {
  it('accepts a boolean isActive and deactivates the user', async () => {
    const token = await loginAsAdmin();

    const res = await patchUser(token, '3', { isActive: false });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { isActive: boolean };
    expect(body.isActive).toBe(false);
  });

  it('accepts a boolean unlockAccount', async () => {
    const token = await loginAsAdmin();

    const res = await patchUser(token, '3', { unlockAccount: true });

    expect(res.status).toBe(200);
  });

  it.each([
    ['isActive', { isActive: 'nope' }],
    ['unlockAccount', { unlockAccount: 'yes' }]
  ])('rejects a non-boolean %s with 400', async (field, payload) => {
    const token = await loginAsAdmin();

    const res = await patchUser(token, '3', payload);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe(`${field} must be a boolean value`);
  });
});
