import type { Server } from 'http';
import { EMAIL_ADDRESS_CORPUS } from '@app/shared/test-fixtures/email-address-corpus';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';
import { isValidEmail } from '../utils/validation';

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

async function send(
  path: string,
  body: unknown
): Promise<{ status: number; body: ErrorBody }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: (await res.json()) as ErrorBody };
}

const ACCEPTED = EMAIL_ADDRESS_CORPUS.filter((entry) => entry.valid).map(
  (entry) => [entry.reason, entry.address] as const
);
const REFUSED = EMAIL_ADDRESS_CORPUS.filter((entry) => !entry.valid).map(
  (entry) => [entry.reason, entry.address] as const
);

const REGISTER_BODY = {
  firstName: 'Format',
  lastName: 'Parity',
  password: 'Sunrise-Kettle-19'
};

/*
 * `isValidEmail` was a regular expression, and it accepted thirteen of the
 * twenty addresses below that `@IsEmail()` answers with 400. The two paths that
 * read the verdict are `emailErrors`, which every address field uses, and
 * `validateCreateUserBody`, which stands behind `POST /auth/register` and the
 * admin `POST /users`; one route of each is driven here.
 */
describe('address format parity with `@IsEmail()`', () => {
  describe('isValidEmail', () => {
    it.each(
      EMAIL_ADDRESS_CORPUS.map(
        (entry) => [entry.reason, entry.address, entry.valid] as const
      )
    )('%s', (_reason, address, valid) => {
      expect(isValidEmail(address)).toBe(valid);
    });

    it('refuses every non-string value', () => {
      expect(isValidEmail(undefined)).toBe(false);
      expect(isValidEmail(null)).toBe(false);
      expect(isValidEmail(42)).toBe(false);
    });
  });

  describe('POST /api/v1/auth/forgot-password', () => {
    it.each(REFUSED)('answers 400 for %s', async (_reason, address) => {
      const { status, body } = await send('/api/v1/auth/forgot-password', {
        email: address
      });

      expect(status).toBe(400);
      expect(body.errors).toEqual(['email must be an email']);
    });

    it.each(ACCEPTED)(
      'stays enumeration-safe for %s',
      async (_reason, address) => {
        const { status, body } = await send('/api/v1/auth/forgot-password', {
          email: address
        });

        expect(status).toBe(200);
        expect(body.errors).toBeUndefined();
      }
    );
  });

  describe('POST /api/v1/auth/register', () => {
    it.each(REFUSED)('answers 400 for %s', async (_reason, address) => {
      const { status, body } = await send('/api/v1/auth/register', {
        ...REGISTER_BODY,
        email: address
      });

      expect(status).toBe(400);
      expect(body.message).toBe('email must be an email');
    });

    it('registers an address both validators accept', async () => {
      const { status } = await send('/api/v1/auth/register', {
        ...REGISTER_BODY,
        email: 'user+tag@example.com'
      });

      expect(status).toBe(201);
    });
  });
});
