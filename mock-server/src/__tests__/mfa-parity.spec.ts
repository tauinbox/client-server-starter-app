import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';
import {
  MOCK_RECOVERY_CODES,
  MOCK_REGENERATED_RECOVERY_CODES,
  MOCK_TOTP_CODE
} from '../constants';
import { MAX_FAILED_ATTEMPTS } from '@app/shared/constants';

let server: Server;
let baseUrl: string;

const CREDENTIALS = { email: 'user@example.com', password: 'Password1' };

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

function post(
  path: string,
  body: unknown,
  accessToken?: string
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(body)
  });
}

async function login(): Promise<Record<string, unknown>> {
  const res = await post('/auth/login', CREDENTIALS);
  return (await res.json()) as Record<string, unknown>;
}

async function accessToken(): Promise<string> {
  const body = (await login()) as {
    tokens: { access_token: string };
  };
  return body.tokens.access_token;
}

/**
 * Stands in for the wait a real authenticator imposes: the enrolment spends
 * the code, and a code is single use. A test that must present the one fixed
 * code again clears the floor rather than sleeping for 30 seconds.
 */
async function clearTotpLedger(): Promise<void> {
  const user = findUserByEmail(CREDENTIALS.email);
  const res = await fetch(`${baseUrl}/__control/totp-ledger`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: user?.id })
  });
  expect(res.status).toBe(200);
}

/** Signs in, enrols, and returns the token of the session that enrolled. */
async function enrol(): Promise<string> {
  const token = await accessToken();
  const setup = await post(
    '/auth/mfa/setup',
    { currentPassword: CREDENTIALS.password },
    token
  );
  expect(setup.status).toBe(200);

  const enable = await post(
    '/auth/mfa/enable',
    { code: MOCK_TOTP_CODE },
    token
  );
  expect(enable.status).toBe(200);
  return token;
}

describe('two-factor enrolment', () => {
  it('returns a secret, a URI and a QR image', async () => {
    const token = await accessToken();

    const res = await post(
      '/auth/mfa/setup',
      { currentPassword: CREDENTIALS.password },
      token
    );
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(200);
    expect(body['otpauthUri']).toContain('otpauth://totp/');
    expect(body['otpauthUri']).toContain(body['secret']);
    expect(body['qrDataUrl'].startsWith('data:image/png;base64,')).toBe(true);
  });

  it('demands the current password before it enrols a device', async () => {
    const token = await accessToken();

    const res = await post('/auth/mfa/setup', {}, token);
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(400);
    expect(body['errorKey']).toBe('errors.auth.invalidCurrentPassword');
  });

  it('refuses an unauthenticated setup', async () => {
    const res = await post('/auth/mfa/setup', {});

    expect(res.status).toBe(401);
  });

  it('does not turn the factor on for a wrong code', async () => {
    const token = await accessToken();
    await post(
      '/auth/mfa/setup',
      { currentPassword: CREDENTIALS.password },
      token
    );

    const res = await post('/auth/mfa/enable', { code: '000000' }, token);
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(401);
    expect(body['errorKey']).toBe('errors.auth.mfaInvalidCode');

    const profile = await login();
    expect(profile).toHaveProperty('tokens');
  });

  it('refuses a confirmation before a setup was started', async () => {
    const token = await accessToken();

    const res = await post('/auth/mfa/enable', { code: MOCK_TOTP_CODE }, token);
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(400);
    expect(body['errorKey']).toBe('errors.auth.mfaSetupRequired');
  });

  it('rejects a code of the wrong length with a validation error', async () => {
    const token = await accessToken();

    const res = await post('/auth/mfa/enable', { code: '12345' }, token);

    expect(res.status).toBe(400);
  });

  it('hands back the recovery codes exactly once', async () => {
    const token = await accessToken();
    await post(
      '/auth/mfa/setup',
      { currentPassword: CREDENTIALS.password },
      token
    );

    const res = await post('/auth/mfa/enable', { code: MOCK_TOTP_CODE }, token);
    const body = (await res.json()) as { recoveryCodes: string[] };

    expect(body.recoveryCodes).toHaveLength(MOCK_RECOVERY_CODES.length);

    const again = await post(
      '/auth/mfa/enable',
      { code: MOCK_TOTP_CODE },
      token
    );
    expect(again.status).toBe(409);
  });

  it('refuses a wrong password before it reports an existing enrolment', async () => {
    const token = await enrol();

    const res = await post(
      '/auth/mfa/setup',
      { currentPassword: 'wrong-value' },
      token
    );
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(400);
    expect(body['errorKey']).toBe('errors.auth.invalidCurrentPassword');
  });

  it('reports an existing enrolment once the password is right', async () => {
    const token = await enrol();

    const res = await post(
      '/auth/mfa/setup',
      { currentPassword: CREDENTIALS.password },
      token
    );
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(409);
    expect(body['errorKey']).toBe('errors.auth.mfaAlreadyEnabled');
  });
});

describe('two-factor sign-in', () => {
  it('answers a correct password with a challenge, not a session', async () => {
    await enrol();

    const body = (await login()) as Record<string, unknown>;

    expect(body).toEqual({
      mfaRequired: true,
      mfaToken: expect.any(String) as unknown,
      expiresIn: 300
    });
    expect(body).not.toHaveProperty('tokens');
  });

  it('refuses the pending token as a bearer credential', async () => {
    await enrol();
    const { mfaToken } = (await login()) as { mfaToken: string };

    const res = await fetch(`${baseUrl}/api/v1/auth/profile`, {
      headers: { authorization: `Bearer ${mfaToken}` }
    });

    expect(res.status).toBe(401);
  });

  it('exchanges the pending token and a code for a session', async () => {
    await enrol();
    await clearTotpLedger();
    const { mfaToken } = (await login()) as { mfaToken: string };

    const res = await post('/auth/mfa/verify', {
      mfaToken,
      code: MOCK_TOTP_CODE
    });
    const body = (await res.json()) as {
      tokens: Record<string, unknown>;
      user: { mfaEnabled: boolean };
    };

    expect(res.status).toBe(200);
    expect(body.tokens).not.toHaveProperty('refresh_token');
    expect(body.user.mfaEnabled).toBe(true);
    expect(res.headers.get('set-cookie')).toContain('refresh_token=');
  });

  it('refuses the same code a second time', async () => {
    // The pending token stays usable for 300 seconds, so without a ledger one
    // observed code buys a second session inside the same challenge.
    await enrol();
    await clearTotpLedger();
    const { mfaToken } = (await login()) as { mfaToken: string };

    const first = await post('/auth/mfa/verify', {
      mfaToken,
      code: MOCK_TOTP_CODE
    });
    expect(first.status).toBe(200);

    const res = await post('/auth/mfa/verify', {
      mfaToken,
      code: MOCK_TOTP_CODE
    });
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(401);
    expect(body['errorKey']).toBe('errors.auth.mfaInvalidCode');
  });

  it('refuses a wrong code', async () => {
    await enrol();
    const { mfaToken } = (await login()) as { mfaToken: string };

    const res = await post('/auth/mfa/verify', { mfaToken, code: '000000' });
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(401);
    expect(body['errorKey']).toBe('errors.auth.mfaInvalidCode');
    expect(res.headers.get('set-cookie') ?? '').not.toContain('refresh_token=');
  });

  it('refuses a token that is not an mfa-pending token', async () => {
    await enrol();

    const res = await post('/auth/mfa/verify', {
      mfaToken: 'not-a-token',
      code: MOCK_TOTP_CODE
    });
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(401);
    expect(body['errorKey']).toBe('errors.auth.mfaInvalidPendingToken');
  });
});

/**
 * The route throttles bound one caller, so they cannot bound one account. These
 * cover the per-account brake, which is the same shape the server carries.
 */
describe('the brake on the authenticator challenge', () => {
  async function guessWrong(mfaToken: string, times: number): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      await post('/auth/mfa/verify', { mfaToken, code: '000000' });
    }
  }

  it('bars the account after the same number of tries the password gets', async () => {
    await enrol();
    const { mfaToken } = (await login()) as { mfaToken: string };

    await guessWrong(mfaToken, MAX_FAILED_ATTEMPTS - 1);
    const res = await post('/auth/mfa/verify', { mfaToken, code: '000000' });
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(423);
    expect(body['errorKey']).toBe('errors.auth.mfaChallengeLocked');
    expect(body['retryAfter']).toEqual(expect.any(Number));
  });

  // A fresh pending token costs one sign-in with the password the caller
  // already holds, so the counter must not be bound to the token.
  it('carries the window across a new pending token', async () => {
    await enrol();
    const first = (await login()) as { mfaToken: string };
    await guessWrong(first.mfaToken, MAX_FAILED_ATTEMPTS);

    const second = (await login()) as { mfaToken: string };
    const res = await post('/auth/mfa/verify', {
      mfaToken: second.mfaToken,
      code: '000000'
    });

    expect(res.status).toBe(423);
  });

  it('refuses a correct code while the account is barred', async () => {
    await enrol();
    const { mfaToken } = (await login()) as { mfaToken: string };
    await guessWrong(mfaToken, MAX_FAILED_ATTEMPTS);
    await clearTotpLedger();

    const res = await post('/auth/mfa/verify', {
      mfaToken,
      code: MOCK_TOTP_CODE
    });

    expect(res.status).toBe(423);
  });

  // A brake that shuts every door lets a caller who holds only the password
  // deny the owner their own account.
  it('leaves the recovery route open while the account is barred', async () => {
    await enrol();
    const { mfaToken } = (await login()) as { mfaToken: string };
    await guessWrong(mfaToken, MAX_FAILED_ATTEMPTS);

    const res = await post('/auth/mfa/recovery', {
      mfaToken,
      recoveryCode: MOCK_RECOVERY_CODES[0]
    });

    expect(res.status).toBe(200);
  });

  it('closes the window on a correct code', async () => {
    await enrol();
    const { mfaToken } = (await login()) as { mfaToken: string };
    await guessWrong(mfaToken, MAX_FAILED_ATTEMPTS - 1);
    await clearTotpLedger();

    const accepted = await post('/auth/mfa/verify', {
      mfaToken,
      code: MOCK_TOTP_CODE
    });
    expect(accepted.status).toBe(200);

    const next = (await login()) as { mfaToken: string };
    const res = await post('/auth/mfa/verify', {
      mfaToken: next.mfaToken,
      code: '000000'
    });

    expect(res.status).toBe(401);
  });

  it('counts the attempt into the audit trail', async () => {
    await enrol();
    const { mfaToken } = (await login()) as { mfaToken: string };

    await post('/auth/mfa/verify', { mfaToken, code: '000000' });
    await post('/auth/mfa/verify', { mfaToken, code: '000000' });

    const failures = getState().auditLogs.filter(
      (entry) => entry.action === 'MFA_CHALLENGE_FAILURE'
    );
    expect(failures.map((entry) => entry.details)).toEqual([
      { stage: 'challenge', attempt: 1 },
      { stage: 'challenge', attempt: 2 }
    ]);
  });
});

describe('recovery codes', () => {
  it('signs the account in once with a recovery code', async () => {
    await enrol();
    const { mfaToken } = (await login()) as { mfaToken: string };

    const res = await post('/auth/mfa/recovery', {
      mfaToken,
      recoveryCode: MOCK_RECOVERY_CODES[0]
    });

    expect(res.status).toBe(200);
  });

  it('refuses the same recovery code a second time', async () => {
    await enrol();
    const first = (await login()) as { mfaToken: string };
    await post('/auth/mfa/recovery', {
      mfaToken: first.mfaToken,
      recoveryCode: MOCK_RECOVERY_CODES[0]
    });

    const second = (await login()) as { mfaToken: string };
    const res = await post('/auth/mfa/recovery', {
      mfaToken: second.mfaToken,
      recoveryCode: MOCK_RECOVERY_CODES[0]
    });
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(401);
    expect(body['errorKey']).toBe('errors.auth.mfaInvalidRecoveryCode');
  });

  it('rejects a malformed recovery code with a validation error', async () => {
    await enrol();
    const { mfaToken } = (await login()) as { mfaToken: string };

    const res = await post('/auth/mfa/recovery', {
      mfaToken,
      recoveryCode: 'nope'
    });

    expect(res.status).toBe(400);
  });
});

describe('replacing the recovery codes', () => {
  it('hands back a fresh set the enrolment did not issue', async () => {
    const token = await enrol();

    const res = await post(
      '/auth/mfa/recovery-codes',
      { currentPassword: CREDENTIALS.password },
      token
    );
    const body = (await res.json()) as { recoveryCodes: string[] };

    expect(res.status).toBe(200);
    expect(body.recoveryCodes).toEqual([...MOCK_REGENERATED_RECOVERY_CODES]);
    expect(body.recoveryCodes).not.toContain(MOCK_RECOVERY_CODES[0]);
  });

  it('retires every code the enrolment issued', async () => {
    const token = await enrol();
    await post(
      '/auth/mfa/recovery-codes',
      { currentPassword: CREDENTIALS.password },
      token
    );

    const { mfaToken } = (await login()) as { mfaToken: string };
    const res = await post('/auth/mfa/recovery', {
      mfaToken,
      recoveryCode: MOCK_RECOVERY_CODES[0]
    });
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(401);
    expect(body['errorKey']).toBe('errors.auth.mfaInvalidRecoveryCode');
  });

  it('signs the account in with a code of the new set', async () => {
    const token = await enrol();
    await post(
      '/auth/mfa/recovery-codes',
      { currentPassword: CREDENTIALS.password },
      token
    );

    const { mfaToken } = (await login()) as { mfaToken: string };
    const res = await post('/auth/mfa/recovery', {
      mfaToken,
      recoveryCode: MOCK_REGENERATED_RECOVERY_CODES[0]
    });

    expect(res.status).toBe(200);
  });

  it('accepts an authenticator code in place of the password', async () => {
    const token = await enrol();
    await clearTotpLedger();

    const res = await post(
      '/auth/mfa/recovery-codes',
      { code: MOCK_TOTP_CODE },
      token
    );

    expect(res.status).toBe(200);
  });

  it('refuses without either factor', async () => {
    const token = await enrol();

    const res = await post('/auth/mfa/recovery-codes', {}, token);
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(400);
    expect(body['errorKey']).toBe('errors.auth.invalidCurrentPassword');
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await post('/auth/mfa/recovery-codes', {
      currentPassword: CREDENTIALS.password
    });

    expect(res.status).toBe(401);
  });

  it('refuses when the factor is not on', async () => {
    const token = await accessToken();

    const res = await post(
      '/auth/mfa/recovery-codes',
      { currentPassword: CREDENTIALS.password },
      token
    );
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(400);
    expect(body['errorKey']).toBe('errors.auth.mfaNotEnabled');
  });

  it('rejects a code of the wrong length with a validation error', async () => {
    const token = await enrol();

    const res = await post('/auth/mfa/recovery-codes', { code: '12' }, token);

    expect(res.status).toBe(400);
  });
});

describe('turning the factor off', () => {
  it('accepts an authenticator code in place of the password', async () => {
    const token = await enrol();
    await clearTotpLedger();

    const res = await post(
      '/auth/mfa/disable',
      { code: MOCK_TOTP_CODE },
      token
    );

    expect(res.status).toBe(200);
    expect(await login()).toHaveProperty('tokens');
  });

  it('refuses a code the enrolment already spent', async () => {
    // The server records the step a code matched at and refuses anything at or
    // below it, so an observed code cannot turn the factor off.
    const token = await enrol();

    const res = await post(
      '/auth/mfa/disable',
      { code: MOCK_TOTP_CODE },
      token
    );
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(400);
    expect(body['errorKey']).toBe('errors.auth.invalidCurrentPassword');
  });

  it('accepts the password', async () => {
    const token = await enrol();

    const res = await post(
      '/auth/mfa/disable',
      { currentPassword: CREDENTIALS.password },
      token
    );

    expect(res.status).toBe(200);
  });

  it('refuses without either factor', async () => {
    const token = await enrol();

    const res = await post('/auth/mfa/disable', {}, token);
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(400);
    expect(body['errorKey']).toBe('errors.auth.invalidCurrentPassword');
    expect(await login()).toHaveProperty('mfaRequired');
  });

  it('refuses when the factor is not on', async () => {
    const token = await accessToken();

    const res = await post(
      '/auth/mfa/disable',
      { currentPassword: CREDENTIALS.password },
      token
    );
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(400);
    expect(body['errorKey']).toBe('errors.auth.mfaNotEnabled');
  });
});
