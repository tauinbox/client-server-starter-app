import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { PASSWORD_TOO_COMMON_MESSAGE } from '@app/shared/utils/password-policy';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

let server: Server;
let baseUrl: string;

// On the local list, and NOT in the mock breach corpus, so only the local
// check can refuse it.
const COMMON_PASSWORD = 'Sunshine123';

const TOO_COMMON = {
  message: PASSWORD_TOO_COMMON_MESSAGE,
  statusCode: 400,
  errorKey: ErrorKeys.AUTH.PASSWORD_TOO_COMMON
};

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

function send(
  method: string,
  path: string,
  body: unknown,
  token?: string
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

async function login(email: string): Promise<string> {
  const res = await send('POST', 'auth/login', {
    email,
    password: 'Password1'
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

describe('the local common-password check mirrors the server verdict', () => {
  it('uses a password the breach corpus does not hold', () => {
    expect(getState().breachedPasswords.has(COMMON_PASSWORD)).toBe(false);
  });

  it('refuses a listed password on register with the server envelope', async () => {
    const res = await send('POST', 'auth/register', {
      email: 'common-register@example.com',
      firstName: 'Common',
      lastName: 'Register',
      password: COMMON_PASSWORD
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(TOO_COMMON);
    expect(findUserByEmail('common-register@example.com')).toBeUndefined();
  });

  it('refuses a password that contains the first name sent with it', async () => {
    const res = await send('POST', 'auth/register', {
      email: 'k.ivanova@example.com',
      firstName: 'Katerina',
      lastName: 'Ivanova',
      password: 'Katerina-Sunrise-19'
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(TOO_COMMON);
  });

  it('answers the local check before the breach corpus', async () => {
    // 'Password1' is in both; the server runs the local check first.
    const res = await send('POST', 'auth/register', {
      email: 'both-lists@example.com',
      firstName: 'Both',
      lastName: 'Lists',
      password: 'Password1'
    });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { errorKey: string }).errorKey).toBe(
      ErrorKeys.AUTH.PASSWORD_TOO_COMMON
    );
  });

  it('refuses a password that contains the account name on reset', async () => {
    const email = 'user@example.com';
    expect((await send('POST', 'auth/forgot-password', { email })).status).toBe(
      200
    );
    const [token] = [...getState().passwordResetTokens.keys()];

    // The seeded account is named Regular User.
    const res = await send('POST', 'auth/reset-password', {
      token,
      password: 'Regular-Sunrise-19'
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(TOO_COMMON);
    expect(findUserByEmail(email)?.password).toBe('Password1');
  });

  it('checks the profile password against the first name sent in the same body', async () => {
    const token = await login('user@example.com');

    const res = await send(
      'PATCH',
      'auth/profile',
      {
        firstName: 'Anastasia',
        password: 'Anastasia-Sunrise-19',
        currentPassword: 'Password1'
      },
      token
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(TOO_COMMON);
    expect(findUserByEmail('user@example.com')?.firstName).toBe('Regular');
  });

  it('refuses a listed password on the admin create', async () => {
    const token = await login('admin@example.com');

    const res = await send(
      'POST',
      'users',
      {
        email: 'common-create@example.com',
        firstName: 'Common',
        lastName: 'Create',
        password: COMMON_PASSWORD
      },
      token
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(TOO_COMMON);
  });

  it('checks the admin update password against the email sent in the same body', async () => {
    const token = await login('admin@example.com');

    const res = await send(
      'PATCH',
      `users/${mockId('user-3')}`,
      {
        email: 'zeppelin@example.com',
        password: 'Sunrise-Zeppelin-19',
        currentPassword: 'Password1'
      },
      token
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(TOO_COMMON);
    expect(getState().users.get(mockId('user-3'))?.email).toBe(
      'john@example.com'
    );
  });
});
