import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createApp } from '../app';
import { getState, resetState } from '../state';

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

async function login(email: string): Promise<{ token: string; id: string }> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    tokens: { access_token: string };
    user: { id: string };
  };
  return { token: body.tokens.access_token, id: body.user.id };
}

async function control(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/__control/billing/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('DELETE /api/v1/users/:id billing side effects', () => {
  it('cancels the deleted user subscriptions so no renewal can charge them', async () => {
    const admin = await login('admin@example.com');
    const user = await login('user@example.com');

    const activate = await control('activate-subscription', {
      userId: user.id,
      planKey: 'pro'
    });
    expect(activate.status).toBe(200);
    const { id: subscriptionId } = (await activate.json()) as { id: string };

    const del = await fetch(`${baseUrl}/api/v1/users/${user.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${admin.token}` }
    });
    expect(del.status).toBe(200);

    const sub = getState().billingSubscriptions.get(subscriptionId);
    expect(sub).toMatchObject({
      status: 'canceled',
      cancelAtPeriodEnd: false
    });

    // The renewal sweep no longer sees the subscription as due.
    const renewal = await control('advance-renewal', { userId: user.id });
    expect(renewal.status).toBe(404);
  });

  it('leaves other users subscriptions untouched', async () => {
    const admin = await login('admin@example.com');
    const user = await login('user@example.com');

    const activate = await control('activate-subscription', {
      userId: admin.id,
      planKey: 'pro'
    });
    expect(activate.status).toBe(200);
    const { id: subscriptionId } = (await activate.json()) as { id: string };

    const del = await fetch(`${baseUrl}/api/v1/users/${user.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${admin.token}` }
    });
    expect(del.status).toBe(200);

    const sub = getState().billingSubscriptions.get(subscriptionId);
    expect(sub?.status).toBe('active');
  });
});
