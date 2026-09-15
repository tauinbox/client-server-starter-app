import type { Server } from 'http';
import { ErrorKeys, MAX_FAILED_ATTEMPTS } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockAuditLog } from '../types';

let server: Server;
let baseUrl: string;

const CREDENTIALS = { email: 'user@example.com', password: 'Password1' };
const WRONG_PASSWORD = 'WrongPassword1';
const NEW_PASSWORD = 'Sunrise-Kettle-19';

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

function request(
  method: string,
  path: string,
  body: unknown,
  accessToken?: string
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(body)
  });
}

async function accessToken(): Promise<string> {
  const res = await request('POST', '/auth/login', CREDENTIALS);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

function setup(token: string, currentPassword?: string): Promise<Response> {
  return request(
    'POST',
    '/auth/mfa/setup',
    currentPassword === undefined ? {} : { currentPassword },
    token
  );
}

async function guessWrong(token: string, times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    const res = await setup(token, WRONG_PASSWORD);
    expect(res.status).toBe(400);
  }
}

function failureRows(): MockAuditLog[] {
  return getState().auditLogs.filter((row) => row.action === 'STEP_UP_FAILURE');
}

describe('the step-up password carries a per-account brake', () => {
  it('bars the account on the attempt that spends the budget', async () => {
    const token = await accessToken();
    await guessWrong(token, MAX_FAILED_ATTEMPTS - 1);

    const res = await setup(token, WRONG_PASSWORD);

    expect(res.status).toBe(423);
    expect(res.headers.get('retry-after')).not.toBeNull();
    expect(await res.json()).toMatchObject({
      statusCode: 423,
      errorKey: ErrorKeys.AUTH.STEP_UP_LOCKED,
      lockedUntil: expect.any(String) as unknown,
      retryAfter: expect.any(Number) as unknown
    });
  });

  it('audits the attempt that bars the account', async () => {
    const token = await accessToken();
    await guessWrong(token, MAX_FAILED_ATTEMPTS - 1);

    await setup(token, WRONG_PASSWORD);

    expect(failureRows()).toHaveLength(MAX_FAILED_ATTEMPTS);
    expect(JSON.stringify(failureRows())).not.toContain(WRONG_PASSWORD);
  });

  it('refuses a correct password while the account is barred', async () => {
    const token = await accessToken();
    await guessWrong(token, MAX_FAILED_ATTEMPTS - 1);
    await setup(token, WRONG_PASSWORD);

    const res = await setup(token, CREDENTIALS.password);

    expect(res.status).toBe(423);
  });

  it('spends one budget across the routes, not one budget per route', async () => {
    const token = await accessToken();
    await guessWrong(token, MAX_FAILED_ATTEMPTS - 1);

    // The route throttle is keyed by client address and by handler. This is
    // the brake that neither of those can move.
    const res = await request(
      'POST',
      '/auth/profile/email/initiate',
      { newEmail: 'new@example.com', currentPassword: WRONG_PASSWORD },
      token
    );

    expect(res.status).toBe(423);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.STEP_UP_LOCKED
    });
  });

  it('bars the password-set route on the same budget', async () => {
    const token = await accessToken();
    await guessWrong(token, MAX_FAILED_ATTEMPTS - 1);

    const res = await request(
      'PATCH',
      '/auth/profile',
      { password: NEW_PASSWORD, currentPassword: WRONG_PASSWORD },
      token
    );

    expect(res.status).toBe(423);
    expect(await res.json()).toMatchObject({
      errorKey: ErrorKeys.AUTH.STEP_UP_LOCKED
    });
  });

  it('does not count a step-up that offers no password', async () => {
    const token = await accessToken();

    for (let i = 0; i < MAX_FAILED_ATTEMPTS * 2; i += 1) {
      const res = await setup(token);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
      });
    }

    expect((await setup(token, CREDENTIALS.password)).status).toBe(200);
  });

  it('closes the window on a correct password', async () => {
    const token = await accessToken();
    await guessWrong(token, MAX_FAILED_ATTEMPTS - 1);

    expect((await setup(token, CREDENTIALS.password)).status).toBe(200);

    await guessWrong(token, MAX_FAILED_ATTEMPTS - 1);
    expect((await setup(token, CREDENTIALS.password)).status).toBe(200);
  });

  it('leaves the sign-in open while the step-up is barred', async () => {
    const token = await accessToken();
    await guessWrong(token, MAX_FAILED_ATTEMPTS - 1);
    await setup(token, WRONG_PASSWORD);

    // The two counters hold separate namespaces on purpose: a caller who holds
    // a stolen session must not be able to shut the owner out of the way back
    // in.
    const res = await request('POST', '/auth/login', CREDENTIALS);

    expect(res.status).toBe(200);
  });
});
