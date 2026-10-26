import type { Server } from 'http';
import { randomUUID } from 'crypto';
import { STEP_UP_OPERATIONS } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';

// Each expected list is the output of the server ValidationPipe, with the
// options of `main.ts`, on the DTO of the route for the same body.

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

type Caller = 'anonymous' | 'user' | 'admin';

const EMAILS: Record<Exclude<Caller, 'anonymous'>, string> = {
  user: 'user@example.com',
  admin: 'admin@example.com'
};

async function tokenOf(caller: Exclude<Caller, 'anonymous'>): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAILS[caller], password: 'Password1' })
  });
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function errorsOf(
  method: string,
  path: string,
  caller: Caller,
  body: unknown
): Promise<string[]> {
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (caller !== 'anonymous') {
    headers['authorization'] = `Bearer ${await tokenOf(caller)}`;
  }
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers,
    body: JSON.stringify(body)
  });
  expect(res.status).toBe(400);
  return ((await res.json()) as { errors: string[] }).errors;
}

const TOKEN_MISSING = [
  'token must be shorter than or equal to 512 characters',
  'token should not be empty',
  'token must be a string'
];
const MFA_TOKEN_MISSING = [
  'mfaToken must be shorter than or equal to 4096 characters',
  'mfaToken should not be empty',
  'mfaToken must be a string'
];
const CODE_MISSING = [
  'code must be longer than or equal to 6 characters',
  'code must be a string'
];
const CODE_NOT_STRING = [
  'code must be longer than or equal to 6 and shorter than or equal to 6 characters',
  'code must be a string'
];
const CURRENT_PASSWORD_MISSING = [
  'currentPassword must be shorter than or equal to 128 characters',
  'currentPassword should not be empty',
  'currentPassword must be a string'
];
const CURRENT_PASSWORD_NOT_STRING = [
  'currentPassword must be shorter than or equal to 128 characters',
  'currentPassword must be a string'
];
const PASSWORD_MISSING = [
  'password must be shorter than or equal to 128 characters',
  'password must be longer than or equal to 8 characters',
  'password should not be empty',
  'password must be a string'
];
const PASSWORD_TOO_SHORT =
  'password must be longer than or equal to 8 characters';
const PASSWORD_NOT_STRING = [
  'password must be shorter than or equal to 128 characters',
  PASSWORD_TOO_SHORT
];
const LOCALE_INVALID = 'locale must be one of the following values: en, ru';
const RECOVERY_CODE_MISMATCH =
  'recoveryCode must match /^[A-Za-z2-7]{8}-?[A-Za-z2-7]{8}(?:-?[A-Za-z2-7]{8})?$/ regular expression';

const OPERATION_INVALID = `operation must be one of the following values: ${STEP_UP_OPERATIONS.join(', ')}`;

const USER_PATH = `/users/${randomUUID()}`;

const cases: [string, string, string, Caller, unknown, string[]][] = [
  [
    'every field of UpdateUserDto, own fields first',
    'PATCH',
    USER_PATH,
    'admin',
    {
      email: 'bad',
      name: '',
      password: 'x',
      locale: 'xx',
      isActive: 'yes',
      unlockAccount: 1
    },
    [
      'isActive must be a boolean value',
      'unlockAccount must be a boolean value',
      'email must be an email',
      'name should not be empty',
      PASSWORD_TOO_SHORT,
      LOCALE_INVALID
    ]
  ],
  [
    'an explicit null in every field of UpdateUserDto',
    'PATCH',
    USER_PATH,
    'admin',
    {
      email: null,
      name: null,
      password: null,
      locale: null,
      isActive: null,
      unlockAccount: null
    },
    [
      'isActive must be a boolean value',
      'unlockAccount must be a boolean value',
      'email must be shorter than or equal to 255 characters',
      'email must be an email',
      'name must be shorter than or equal to 255 characters',
      'name should not be empty',
      'password must be shorter than or equal to 128 characters',
      PASSWORD_TOO_SHORT,
      'password should not be empty',
      LOCALE_INVALID
    ]
  ],
  [
    'an unknown property beside UpdateUserDto fields',
    'PATCH',
    USER_PATH,
    'admin',
    { extra: 1, email: 'bad', isActive: 'x' },
    [
      'property extra should not exist',
      'isActive must be a boolean value',
      'email must be an email'
    ]
  ],
  [
    'the step-up factors after the UpdateUserDto fields',
    'PATCH',
    USER_PATH,
    'admin',
    { email: 'bad', currentPassword: '', code: '12', isActive: 'x' },
    [
      'isActive must be a boolean value',
      'email must be an email',
      'currentPassword should not be empty',
      'code must be longer than or equal to 6 characters'
    ]
  ],
  [
    'step-up factors that are not strings',
    'PATCH',
    USER_PATH,
    'admin',
    { currentPassword: 5, code: 5 },
    [...CURRENT_PASSWORD_NOT_STRING, ...CODE_NOT_STRING]
  ],
  [
    'a number password and a blank name on UpdateUserDto',
    'PATCH',
    USER_PATH,
    'admin',
    { password: 5, name: '  ' },
    ['name should not be empty', ...PASSWORD_NOT_STRING]
  ],
  [
    'every field of UpdateProfileDto',
    'PATCH',
    '/auth/profile',
    'user',
    { name: '', password: 'x', locale: 'xx' },
    ['name should not be empty', PASSWORD_TOO_SHORT, LOCALE_INVALID]
  ],
  [
    'an explicit null in every field of UpdateProfileDto',
    'PATCH',
    '/auth/profile',
    'user',
    { name: null, password: null, locale: null },
    [
      'name must be shorter than or equal to 255 characters',
      'name should not be empty',
      ...PASSWORD_NOT_STRING,
      LOCALE_INVALID
    ]
  ],
  [
    'the step-up factors after the UpdateProfileDto fields',
    'PATCH',
    '/auth/profile',
    'user',
    {
      name: '',
      password: 'x',
      locale: 'xx',
      currentPassword: '',
      code: '1'
    },
    [
      'name should not be empty',
      PASSWORD_TOO_SHORT,
      LOCALE_INVALID,
      'currentPassword should not be empty',
      'code must be longer than or equal to 6 characters'
    ]
  ],
  [
    'an unknown property and the step-up factors on UpdateProfileDto',
    'PATCH',
    '/auth/profile',
    'user',
    { extra: 1, name: '', code: '1', currentPassword: 5 },
    [
      'property extra should not exist',
      'name should not be empty',
      ...CURRENT_PASSWORD_NOT_STRING,
      'code must be longer than or equal to 6 characters'
    ]
  ],
  [
    'null step-up factors',
    'PATCH',
    '/auth/profile',
    'user',
    { currentPassword: null, code: null },
    [...CURRENT_PASSWORD_MISSING, ...CODE_MISSING]
  ],
  [
    'the step-up factors after newEmail',
    'POST',
    '/auth/profile/email/initiate',
    'user',
    { newEmail: 'bad', currentPassword: '', code: '1234567' },
    [
      'newEmail must be an email',
      'currentPassword should not be empty',
      'code must be shorter than or equal to 6 characters'
    ]
  ],
  [
    'an unknown property and the factors on StepUpFactorsDto',
    'DELETE',
    '/auth/sessions',
    'user',
    { extra: 1, currentPassword: '', code: 5 },
    [
      'property extra should not exist',
      'currentPassword should not be empty',
      ...CODE_NOT_STRING
    ]
  ],
  [
    'a currentPassword over the cap on StepUpFactorsDto',
    'DELETE',
    '/auth/sessions',
    'user',
    { currentPassword: 'x'.repeat(129) },
    ['currentPassword must be shorter than or equal to 128 characters']
  ],
  [
    'an empty VerifyEmailDto',
    'POST',
    '/auth/verify-email',
    'anonymous',
    {},
    TOKEN_MISSING
  ],
  [
    'a number token on VerifyEmailDto',
    'POST',
    '/auth/verify-email',
    'anonymous',
    { token: 5 },
    [
      'token must be shorter than or equal to 512 characters',
      'token must be a string'
    ]
  ],
  [
    'an empty token on VerifyEmailDto',
    'POST',
    '/auth/verify-email',
    'anonymous',
    { token: '' },
    ['token should not be empty']
  ],
  [
    'an unknown property on VerifyEmailDto',
    'POST',
    '/auth/verify-email',
    'anonymous',
    { extra: 1 },
    ['property extra should not exist', ...TOKEN_MISSING]
  ],
  [
    'an empty ConfirmEmailChangeDto',
    'POST',
    '/auth/profile/email/confirm',
    'anonymous',
    {},
    TOKEN_MISSING
  ],
  [
    'an empty ResetPasswordDto',
    'POST',
    '/auth/reset-password',
    'anonymous',
    {},
    [...TOKEN_MISSING, ...PASSWORD_MISSING]
  ],
  [
    'empty strings on ResetPasswordDto',
    'POST',
    '/auth/reset-password',
    'anonymous',
    { token: '', password: '' },
    [
      'token should not be empty',
      PASSWORD_TOO_SHORT,
      'password should not be empty'
    ]
  ],
  [
    'an unknown property on ResetPasswordDto',
    'POST',
    '/auth/reset-password',
    'anonymous',
    { extra: 1, token: 't' },
    ['property extra should not exist', ...PASSWORD_MISSING]
  ],
  [
    'a null currentPassword on MfaSetupDto',
    'POST',
    '/auth/mfa/setup',
    'user',
    { currentPassword: null },
    CURRENT_PASSWORD_MISSING
  ],
  [
    'an unknown property on MfaSetupDto',
    'POST',
    '/auth/mfa/setup',
    'user',
    { extra: 1, currentPassword: 5 },
    ['property extra should not exist', ...CURRENT_PASSWORD_NOT_STRING]
  ],
  [
    'an empty MfaEnableDto',
    'POST',
    '/auth/mfa/enable',
    'user',
    {},
    CODE_MISSING
  ],
  [
    'an unknown property on MfaEnableDto',
    'POST',
    '/auth/mfa/enable',
    'user',
    { extra: 1, code: '12' },
    [
      'property extra should not exist',
      'code must be longer than or equal to 6 characters'
    ]
  ],
  [
    'an empty MfaVerifyDto',
    'POST',
    '/auth/mfa/verify',
    'anonymous',
    {},
    [...MFA_TOKEN_MISSING, ...CODE_MISSING]
  ],
  [
    'an unknown property on MfaVerifyDto',
    'POST',
    '/auth/mfa/verify',
    'anonymous',
    { extra: 1, mfaToken: '', code: '1234567' },
    [
      'property extra should not exist',
      'mfaToken should not be empty',
      'code must be shorter than or equal to 6 characters'
    ]
  ],
  [
    'an empty MfaRecoveryDto',
    'POST',
    '/auth/mfa/recovery',
    'anonymous',
    {},
    [
      ...MFA_TOKEN_MISSING,
      RECOVERY_CODE_MISMATCH,
      'recoveryCode must be a string'
    ]
  ],
  [
    'an unknown property on MfaRecoveryDto',
    'POST',
    '/auth/mfa/recovery',
    'anonymous',
    { extra: 1, mfaToken: '', recoveryCode: 'x' },
    [
      'property extra should not exist',
      'mfaToken should not be empty',
      RECOVERY_CODE_MISMATCH
    ]
  ],
  [
    'an empty ReauthInitDto',
    'POST',
    '/auth/oauth/reauth-init',
    'user',
    {},
    [OPERATION_INVALID]
  ],
  [
    'an unknown property on ReauthInitDto',
    'POST',
    '/auth/oauth/reauth-init',
    'user',
    { extra: 1, operation: 5 },
    ['property extra should not exist', OPERATION_INVALID]
  ]
];

describe('a body with several violations lists all of them', () => {
  it.each(cases)(
    '%s (%s %s)',
    async (_label, method, path, caller, body, expected) => {
      expect(await errorsOf(method, path, caller, body)).toEqual(expected);
    }
  );
});
