import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

// Each expected list is the output of the server ValidationPipe, with the
// options of `main.ts`, on `CreateUserDto` and `RegisterDto` for the same body.

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

async function adminToken(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function errorsOf(res: Response): Promise<string[]> {
  expect(res.status).toBe(400);
  return ((await res.json()) as { errors: string[] }).errors;
}

async function register(body: unknown): Promise<string[]> {
  return errorsOf(
    await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  );
}

async function adminCreate(body: unknown): Promise<string[]> {
  return errorsOf(
    await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await adminToken()}`
      },
      body: JSON.stringify(body)
    })
  );
}

const EMAIL = 'new-user@example.com';
const PASSWORD = 'Lantern-Orchard-47';

const EMAIL_MISSING = [
  'email must be shorter than or equal to 255 characters',
  'email must be an email'
];
const NAME_MISSING = [
  'name must be shorter than or equal to 255 characters',
  'name should not be empty'
];
const PASSWORD_MISSING = [
  'password must be shorter than or equal to 128 characters',
  'password must be longer than or equal to 8 characters',
  'password should not be empty'
];

const CASES: [string, Record<string, unknown>, string[]][] = [
  ['a missing email', { name: 'Ada', password: PASSWORD }, EMAIL_MISSING],
  ['a missing name', { email: EMAIL, password: PASSWORD }, NAME_MISSING],
  ['a missing password', { email: EMAIL, name: 'Ada' }, PASSWORD_MISSING],
  [
    'an empty body',
    {},
    [...EMAIL_MISSING, ...NAME_MISSING, ...PASSWORD_MISSING]
  ],
  [
    'empty strings',
    { email: '', name: '', password: '' },
    [
      'email must be an email',
      'name should not be empty',
      'password must be longer than or equal to 8 characters',
      'password should not be empty'
    ]
  ],
  [
    'nulls',
    { email: null, name: null, password: null, locale: null },
    [
      ...EMAIL_MISSING,
      ...NAME_MISSING,
      ...PASSWORD_MISSING,
      'locale must be one of the following values: en, ru'
    ]
  ],
  [
    'numbers',
    { email: 5, name: 5, password: 12345678 },
    [
      ...EMAIL_MISSING,
      'name must be shorter than or equal to 255 characters',
      'password must be shorter than or equal to 128 characters',
      'password must be longer than or equal to 8 characters'
    ]
  ],
  [
    'a failure in every field',
    { email: 'bad', name: 'a'.repeat(256), password: 'x', locale: 'xx' },
    [
      'email must be an email',
      'name must be shorter than or equal to 255 characters',
      'password must be longer than or equal to 8 characters',
      'locale must be one of the following values: en, ru'
    ]
  ],
  [
    'an unknown property beside a missing field',
    { foo: 1, email: EMAIL, name: 'Ada' },
    ['property foo should not exist', ...PASSWORD_MISSING]
  ],
  [
    'an unknown property alone',
    { email: EMAIL, name: 'Ada', password: PASSWORD, foo: 1 },
    ['property foo should not exist']
  ]
];

describe.each([
  ['POST /auth/register', register],
  ['POST /users', adminCreate]
])('%s lists every violation of the body', (_route, send) => {
  it.each(CASES)('for %s', async (_case, body, expected) => {
    expect(await send(body)).toEqual(expected);
  });
});

describe('captchaToken', () => {
  const body = { captchaToken: 5, email: EMAIL, name: 'Ada' };

  it('is validated ahead of the inherited fields on register', async () => {
    expect(await register(body)).toEqual([
      'captchaToken must be shorter than or equal to 2048 characters',
      'captchaToken must be a string',
      ...PASSWORD_MISSING
    ]);
  });

  it('is an unknown property on an admin create', async () => {
    expect(await adminCreate(body)).toEqual([
      'property captchaToken should not exist',
      ...PASSWORD_MISSING
    ]);
  });
});
