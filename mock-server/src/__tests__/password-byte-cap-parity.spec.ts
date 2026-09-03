import type { Server } from 'http';
import { ErrorKeys, MAX_PASSWORD_LENGTH } from '@app/shared/constants';
import { createApp } from '../app';
import { resetState } from '../state';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { passwordLengthError } from '../utils/validation';

// Mirrors the server split: a path that SETS a password caps at 72 bytes,
// because bcrypt ignores the rest; a path that only VERIFIES one keeps 128.
let server: Server;
let baseUrl: string;

// 'Parol1' written in Cyrillic, then 30 more Cyrillic letters: 37 characters
// and 73 bytes.
const CYRILLIC_73_BYTES = 'Пароль1' + 'я'.repeat(30);
const ASCII_128 = 'A1' + 'a'.repeat(126);
const BYTE_MESSAGE =
  'password is too long: some characters count as more than one byte, ' +
  'so it must be at most 72 bytes';

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
  it('accepts a password of exactly 72 bytes', () => {
    expect(passwordLengthError('A1' + 'a'.repeat(70))).toBeNull();
  });

  it('rejects 73 ASCII characters on the character cap', () => {
    expect(passwordLengthError('A1' + 'a'.repeat(71))).toBe(
      'password must be shorter than or equal to 72 characters'
    );
  });

  it('rejects a 37-character Cyrillic password on the byte cap', () => {
    expect(CYRILLIC_73_BYTES).toHaveLength(37);
    expect(passwordLengthError(CYRILLIC_73_BYTES)).toBe(BYTE_MESSAGE);
  });
});

describe('POST /api/v1/auth/register', () => {
  it('rejects a 73-byte Cyrillic password with the byte message', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'byte.cap@example.com',
        firstName: 'Byte',
        lastName: 'Cap',
        password: CYRILLIC_73_BYTES
      })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors?: string[] };
    expect(body.errors).toContain(BYTE_MESSAGE);
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
