import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';
import { MOCK_RECOVERY_CODES, MOCK_TOTP_CODE } from '../constants';

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

describe('turning the factor off', () => {
  it('accepts an authenticator code in place of the password', async () => {
    const token = await enrol();

    const res = await post(
      '/auth/mfa/disable',
      { code: MOCK_TOTP_CODE },
      token
    );

    expect(res.status).toBe(200);
    expect(await login()).toHaveProperty('tokens');
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
