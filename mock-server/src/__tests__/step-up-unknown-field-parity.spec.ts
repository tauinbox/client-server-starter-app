import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockUser } from '../types';

// The server ValidationPipe runs with `forbidNonWhitelisted`, so a step-up body
// with a field its DTO does not declare is a 400 before any factor is read.
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

function userId(email: string): string {
  return (
    [...getState().users.values()].find((u) => u.email === email) as MockUser
  ).id;
}

async function login(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password1' })
  });
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

const routes: ReadonlyArray<
  [method: string, path: () => string, body: object]
> = [
  ['PATCH', () => '/api/v1/auth/profile', { firstName: 'Jane' }],
  [
    'POST',
    () => '/api/v1/auth/profile/email/initiate',
    { newEmail: 'unknown-field@example.com' }
  ],
  ['POST', () => '/api/v1/auth/oauth/link-init', {}],
  ['DELETE', () => '/api/v1/auth/oauth/accounts/google', {}],
  ['POST', () => '/api/v1/auth/mfa/setup', {}],
  ['POST', () => '/api/v1/auth/mfa/disable', {}],
  ['POST', () => '/api/v1/auth/mfa/recovery-codes', {}],
  ['DELETE', () => '/api/v1/auth/sessions', {}],
  ['POST', () => `/api/v1/users/${userId('user@example.com')}/mfa/reset`, {}],
  [
    'PATCH',
    () => `/api/v1/users/${userId('user@example.com')}`,
    { firstName: 'Jane' }
  ]
];

it.each(routes)(
  '%s %s refuses a field its DTO does not declare',
  async (method, path, body) => {
    const token = await login('admin@example.com');

    const res = await fetch(`${baseUrl}${path()}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ ...body, extra: 1 })
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      message: 'property extra should not exist'
    });
  }
);
