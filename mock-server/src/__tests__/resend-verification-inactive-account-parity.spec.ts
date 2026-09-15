import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

let server: Server;
let baseUrl: string;

const email = 'user@example.com';

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

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function makeUnverified(active: boolean): void {
  const user = findUserByEmail(email);
  expect(user).toBeDefined();
  user!.isEmailVerified = false;
  user!.isActive = active;
}

describe('resend-verification against a deactivated account', () => {
  it('issues no token for a deactivated unverified account', async () => {
    makeUnverified(false);

    const res = await postJson('resend-verification', { email });

    expect(res.status).toBe(200);
    expect(getState().emailVerificationTokens.size).toBe(0);
  });

  it('answers the deactivated case exactly like an unknown address', async () => {
    makeUnverified(false);

    const deactivated = await postJson('resend-verification', { email });
    const unknown = await postJson('resend-verification', {
      email: 'no-such-address@example.com'
    });

    expect(deactivated.status).toBe(unknown.status);
    expect(await deactivated.json()).toEqual(await unknown.json());
  });

  it('still issues a token while the account stays active', async () => {
    makeUnverified(true);

    const res = await postJson('resend-verification', { email });

    expect(res.status).toBe(200);
    expect(getState().emailVerificationTokens.size).toBe(1);
  });
});
