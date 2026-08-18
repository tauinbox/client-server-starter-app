import type { Server } from 'http';
import { ErrorKeys } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

let server: Server;
let baseUrl: string;

const CLAIMED_EMAIL = 'claimed@example.com';

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

async function send(
  method: string,
  path: string,
  body: unknown,
  token?: string
): Promise<{ status: number; body: { message: string; errorKey?: string } }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  return {
    status: res.status,
    body: (await res.json()) as { message: string; errorKey?: string }
  };
}

/** Parks `CLAIMED_EMAIL` as the seeded user's pending address. */
async function claimAsPendingEmail(): Promise<void> {
  const token = await login('user@example.com');
  const { status } = await send(
    'POST',
    '/api/v1/auth/profile/email/initiate',
    { newEmail: CLAIMED_EMAIL, currentPassword: 'Password1' },
    token
  );
  expect(status).toBe(200);
}

const createBody = {
  email: CLAIMED_EMAIL,
  firstName: 'Pending',
  lastName: 'Claim',
  password: 'Password1'
};

// Both create paths resolve the same uniqueness rule on the real server -
// `[{ email }, { pendingEmail: email }]` in `AuthService.register` and in
// `UsersService.create` - so an address parked by an unconfirmed email change
// is taken on both, and neither may hand it out first-come.
describe('create-user pending-email conflict parity with server', () => {
  it('rejects registration for an address held as a pending email', async () => {
    await claimAsPendingEmail();

    const { status, body } = await send(
      'POST',
      '/api/v1/auth/register',
      createBody
    );

    expect(status).toBe(409);
    expect(body.errorKey).toBe(ErrorKeys.USERS.EMAIL_EXISTS);
  });

  it('rejects admin user creation for an address held as a pending email', async () => {
    await claimAsPendingEmail();
    const adminToken = await login('admin@example.com');

    const { status, body } = await send(
      'POST',
      '/api/v1/users',
      createBody,
      adminToken
    );

    expect(status).toBe(409);
    expect(body.errorKey).toBe(ErrorKeys.USERS.EMAIL_EXISTS);
  });

  it('still creates the user on both paths when nothing holds the address', async () => {
    const registered = await send('POST', '/api/v1/auth/register', {
      ...createBody,
      email: 'fresh-register@example.com'
    });
    expect(registered.status).toBe(201);

    const adminToken = await login('admin@example.com');
    const created = await send(
      'POST',
      '/api/v1/users',
      { ...createBody, email: 'fresh-admin@example.com' },
      adminToken
    );
    expect(created.status).toBe(201);
  });
});
