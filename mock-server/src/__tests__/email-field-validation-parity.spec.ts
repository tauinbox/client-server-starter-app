import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, resetState } from '../state';

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

type ErrorBody = { message: string; errors?: string[] };

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
): Promise<{ status: number; body: ErrorBody }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as ErrorBody };
}

/*
 * Every address field on the server carries `@Transform(normalizeEmail)`,
 * `@IsEmail()` and `@MaxLength(255)` with no `@IsOptional()`. Both validators
 * run on every body, so a value that fails both produces two messages. Driving
 * the application's own ValidationPipe options over ForgotPasswordDto and
 * ResendVerificationDto returned:
 *
 *   {}              -> 400 ["email must be shorter than or equal to 255 characters",
 *                           "email must be an email"]
 *   {email: null}   -> 400 (the same two)
 *   {email: 123}    -> 400 (the same two)
 *   {email: ''}     -> 400 ["email must be an email"]
 *   {email: '   '}  -> 400 ["email must be an email"]
 *   {email: 'nope'} -> 400 ["email must be an email"]
 *
 * The mock used to answer the enumeration-safe 200 for the first three shapes
 * on /resend-verification and /forgot-password, so a client that sent no
 * address passed the whole e2e suite and failed in production.
 */
const TWO_MESSAGES = [
  'email must be shorter than or equal to 255 characters',
  'email must be an email'
];
const ONE_MESSAGE = ['email must be an email'];

describe('email field validation parity with the server DTOs', () => {
  describe.each([
    ['/api/v1/auth/resend-verification'],
    ['/api/v1/auth/forgot-password']
  ])('POST %s', (path) => {
    it('rejects an absent address with both validator messages', async () => {
      const { status, body } = await send('POST', path, {});

      expect(status).toBe(400);
      expect(body.errors).toEqual(TWO_MESSAGES);
      expect(body.message).toBe(TWO_MESSAGES.join('. '));
    });

    it('rejects a null address with both validator messages', async () => {
      const { status, body } = await send('POST', path, { email: null });

      expect(status).toBe(400);
      expect(body.errors).toEqual(TWO_MESSAGES);
    });

    it('rejects a non-string address with both validator messages', async () => {
      const { status, body } = await send('POST', path, { email: 123 });

      expect(status).toBe(400);
      expect(body.errors).toEqual(TWO_MESSAGES);
    });

    it('rejects an empty address with the email message alone', async () => {
      const { status, body } = await send('POST', path, { email: '' });

      expect(status).toBe(400);
      expect(body.errors).toEqual(ONE_MESSAGE);
    });

    it('rejects a whitespace-only address with the email message alone', async () => {
      const { status, body } = await send('POST', path, { email: '   ' });

      expect(status).toBe(400);
      expect(body.errors).toEqual(ONE_MESSAGE);
    });

    it('rejects a malformed address with the email message alone', async () => {
      const { status, body } = await send('POST', path, { email: 'nope' });

      expect(status).toBe(400);
      expect(body.errors).toEqual(ONE_MESSAGE);
    });

    it('stays enumeration-safe for a well-formed unknown address', async () => {
      const { status, body } = await send('POST', path, {
        email: 'nobody@example.com'
      });

      expect(status).toBe(200);
      expect(body.errors).toBeUndefined();
      expect(body.message).toContain('If an account with that email exists');
    });
  });

  describe('POST /api/v1/auth/profile/email/initiate', () => {
    it('rejects an absent newEmail with both validator messages', async () => {
      const token = await login('user@example.com');
      const { status, body } = await send(
        'POST',
        '/api/v1/auth/profile/email/initiate',
        { currentPassword: 'Password1' },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toEqual([
        'newEmail must be shorter than or equal to 255 characters',
        'newEmail must be an email'
      ]);
    });

    it('rejects an empty newEmail with the email message alone', async () => {
      const token = await login('user@example.com');
      const { status, body } = await send(
        'POST',
        '/api/v1/auth/profile/email/initiate',
        { newEmail: '', currentPassword: 'Password1' },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toEqual(['newEmail must be an email']);
    });
  });

  describe('PATCH /api/v1/users/:id', () => {
    it('rejects a non-string email with both validator messages', async () => {
      const token = await login('admin@example.com');
      const target = findUserByEmail('user@example.com');
      const { status, body } = await send(
        'PATCH',
        `/api/v1/users/${target?.id}`,
        { email: 123 },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toEqual(TWO_MESSAGES);
    });

    it('rejects a malformed email with the email message alone', async () => {
      const token = await login('admin@example.com');
      const target = findUserByEmail('user@example.com');
      const { status, body } = await send(
        'PATCH',
        `/api/v1/users/${target?.id}`,
        { email: 'nope' },
        token
      );

      expect(status).toBe(400);
      expect(body.errors).toEqual(ONE_MESSAGE);
    });
  });
});
