import type { Server } from 'http';
import { ErrorKeys, MAX_PASSWORD_LENGTH } from '@app/shared/constants';
import { createApp } from '../app';
import { resetState } from '../state';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { passwordLengthError } from '../utils/validation';

// Mirrors the server: the password is pre-hashed before bcrypt, so every
// path caps at MAX_PASSWORD_LENGTH characters whatever their byte count.
let server: Server;
let baseUrl: string;

// 'Parol1' written in Cyrillic, then 57 more Cyrillic letters: 64 characters
// and 128 bytes, which the old 72-byte cap refused.
const CYRILLIC_64 = 'Пароль1' + 'я'.repeat(57);
const ASCII_128 = 'A1' + 'a'.repeat(126);

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

describe('passwordLengthError', () => {
  it('accepts 64 Cyrillic characters', () => {
    expect(CYRILLIC_64).toHaveLength(64);
    expect(passwordLengthError(CYRILLIC_64)).toBeNull();
  });

  it(`accepts ${MAX_PASSWORD_LENGTH} characters`, () => {
    expect(passwordLengthError(ASCII_128)).toBeNull();
  });

  it(`rejects ${MAX_PASSWORD_LENGTH + 1} characters`, () => {
    expect(passwordLengthError(ASCII_128 + 'a')).toBe(
      `password must be shorter than or equal to ${MAX_PASSWORD_LENGTH} characters`
    );
  });
});

describe('POST /api/v1/auth/register', () => {
  it('accepts a 64-character Cyrillic password', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'long.cyrillic@example.com',
        firstName: 'Olga',
        lastName: 'Smirnova',
        password: CYRILLIC_64
      })
    });

    expect(res.status).toBe(201);
  });
});

describe('POST /api/v1/auth/profile/email/initiate', () => {
  it('still reaches the credential check with a 128-character currentPassword', async () => {
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        password: 'Password1'
      })
    });
    expect(login.status).toBe(200);
    const tokens = (await login.json()) as {
      tokens: { access_token: string };
    };

    expect(ASCII_128).toHaveLength(MAX_PASSWORD_LENGTH);
    const res = await fetch(`${baseUrl}/api/v1/auth/profile/email/initiate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokens.tokens.access_token}`
      },
      body: JSON.stringify({
        newEmail: 'moved@example.com',
        currentPassword: ASCII_128
      })
    });

    // A wrong password, not a length rejection: the value passed validation.
    const body = (await res.json()) as { errorKey?: string };
    expect(body.errorKey).toBe(ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD);
  });
});
