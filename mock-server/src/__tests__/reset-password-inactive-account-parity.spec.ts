import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

let server: Server;
let baseUrl: string;

const email = 'user@example.com';
const newPassword = 'NewPassword1';
const oldPassword = 'Password1';

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

async function issueResetToken(): Promise<string> {
  const res = await postJson('forgot-password', { email });
  expect(res.status).toBe(200);

  const [token] = [...getState().passwordResetTokens.keys()];
  expect(token).toBeDefined();
  return token;
}

const invalidTokenBody = {
  message: 'Invalid or expired password reset token',
  errorKey: ErrorKeys.AUTH.INVALID_RESET_TOKEN
};

describe('reset-password against a deactivated account', () => {
  it('refuses the reset once the account is deactivated', async () => {
    const token = await issueResetToken();
    findUserByEmail(email)!.isActive = false;

    const res = await postJson('reset-password', {
      token,
      password: newPassword
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(invalidTokenBody);
    expect(findUserByEmail(email)?.password).toBe(oldPassword);
  });

  it('answers the deactivated case exactly like an unknown token', async () => {
    const token = await issueResetToken();
    findUserByEmail(email)!.isActive = false;

    const deactivated = await postJson('reset-password', {
      token,
      password: newPassword
    });
    const unknown = await postJson('reset-password', {
      token: 'no-such-reset-token',
      password: newPassword
    });

    expect(deactivated.status).toBe(unknown.status);
    expect(await deactivated.json()).toEqual(await unknown.json());
  });

  it('keeps the token usable while the account stays active', async () => {
    const token = await issueResetToken();

    const res = await postJson('reset-password', {
      token,
      password: newPassword
    });
    expect(res.status).toBe(200);
    expect(findUserByEmail(email)?.password).toBe(newPassword);
  });
});
