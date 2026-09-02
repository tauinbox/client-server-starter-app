import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';
import { MOCK_TOTP_CODE } from '../constants';

let server: Server;
let baseUrl: string;

const ADMIN = { email: 'admin@example.com', password: 'Password1' };
const USER = { email: 'user@example.com', password: 'Password1' };

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

afterEach(() => {
  delete process.env['MFA_REQUIRED_FOR_ADMINS'];
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

function get(path: string, accessToken: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
}

async function accessToken(credentials: typeof ADMIN = ADMIN): Promise<string> {
  const res = await post('/auth/login', credentials);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function enrol(token: string): Promise<void> {
  const setup = await post(
    '/auth/mfa/setup',
    { currentPassword: ADMIN.password },
    token
  );
  expect(setup.status).toBe(200);
  const enable = await post(
    '/auth/mfa/enable',
    { code: MOCK_TOTP_CODE },
    token
  );
  expect(enable.status).toBe(200);
}

describe('two-factor requirement for a super role', () => {
  it('leaves the administration surface open while nobody opted in', async () => {
    const token = await accessToken();

    const res = await get('/roles', token);

    expect(res.status).toBe(200);
  });

  it('reports the demand as off in the permissions payload', async () => {
    const token = await accessToken();

    const res = await get('/auth/permissions', token);
    const body = (await res.json()) as { mfaMandatory: boolean };

    expect(body.mfaMandatory).toBe(false);
  });

  it('refuses the administration surface to a super role with no factor', async () => {
    process.env['MFA_REQUIRED_FOR_ADMINS'] = 'true';
    const token = await accessToken();

    const res = await get('/roles', token);
    const body = (await res.json()) as Record<string, string>;

    expect(res.status).toBe(403);
    expect(body['errorKey']).toBe('errors.auth.mfaEnrolmentRequired');
  });

  it('still signs the account in and still serves its profile', async () => {
    process.env['MFA_REQUIRED_FOR_ADMINS'] = 'true';
    const token = await accessToken();

    const profile = await get('/auth/profile', token);

    expect(profile.status).toBe(200);
  });

  it('reports the demand in the permissions payload', async () => {
    process.env['MFA_REQUIRED_FOR_ADMINS'] = 'true';
    const token = await accessToken();

    const res = await get('/auth/permissions', token);
    const body = (await res.json()) as { mfaMandatory: boolean };

    expect(body.mfaMandatory).toBe(true);
  });

  it('opens the surface once the enrolment is complete', async () => {
    process.env['MFA_REQUIRED_FOR_ADMINS'] = 'true';
    const token = await accessToken();
    await enrol(token);

    const res = await get('/roles', token);

    expect(res.status).toBe(200);
  });

  it('does not apply to an account without a super role', async () => {
    process.env['MFA_REQUIRED_FOR_ADMINS'] = 'true';
    const token = await accessToken(USER);

    const res = await get('/auth/permissions', token);
    const body = (await res.json()) as { mfaMandatory: boolean };

    expect(body.mfaMandatory).toBe(false);
  });
});
