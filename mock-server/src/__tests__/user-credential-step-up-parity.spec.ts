import type { Server } from 'http';
import { ErrorKeys, STEP_UP_OPERATION } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { findUserByEmail, getState, resetState } from '../state';

// Mirrors server/test/user-credential-step-up.e2e-spec.ts: PATCH /users/:id
// demands the step-up of the CALLER for a password or an email change.

const SEED_PASSWORD = 'Password1';
const NEW_PASSWORD = 'Copper-Meadow-83';

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

async function login(email: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: SEED_PASSWORD })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

function patch(token: string, id: string, body: object) {
  return fetch(`${baseUrl}/api/v1/users/${id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

function stepUpFailures(actorEmail: string) {
  return getState().auditLogs.filter(
    (row) => row.action === 'STEP_UP_FAILURE' && row.actorEmail === actorEmail
  );
}

describe('PATCH /api/v1/users/:id credential step-up parity', () => {
  it('refuses a password change on the own record without a factor', async () => {
    const token = await login('user@example.com');
    const self = findUserByEmail('user@example.com')!;

    const res = await patch(token, self.id, { password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    expect(((await res.json()) as { errorKey: string }).errorKey).toBe(
      ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
    );
    expect(self.password).toBe(SEED_PASSWORD);
    expect(stepUpFailures('user@example.com').at(-1)?.details).toMatchObject({
      operation: STEP_UP_OPERATION.USER_CREDENTIAL_CHANGE,
      factor: 'password'
    });
  });

  it('refuses an email change on the own record without a factor', async () => {
    const token = await login('user@example.com');
    const self = findUserByEmail('user@example.com')!;

    const res = await patch(token, self.id, { email: 'moved@example.com' });

    expect(res.status).toBe(400);
    expect(self.email).toBe('user@example.com');
  });

  it('refuses an administrator without the administrator factor', async () => {
    const token = await login('admin@example.com');
    const target = findUserByEmail('user@example.com')!;

    const res = await patch(token, target.id, {
      password: NEW_PASSWORD,
      currentPassword: 'Wrong-Password-00'
    });

    expect(res.status).toBe(400);
    expect(target.password).toBe(SEED_PASSWORD);
  });

  it('keeps a name edit and a resubmitted address free of a factor', async () => {
    const token = await login('user@example.com');
    const self = findUserByEmail('user@example.com')!;

    expect((await patch(token, self.id, { firstName: 'Renamed' })).status).toBe(
      200
    );
    expect(
      (await patch(token, self.id, { email: 'user@example.com' })).status
    ).toBe(200);
    expect(self.firstName).toBe('Renamed');
  });

  it('answers 403 for another record before it reads a factor', async () => {
    const token = await login('user@example.com');
    const other = findUserByEmail('admin@example.com')!;
    const before = stepUpFailures('user@example.com').length;

    const res = await patch(token, other.id, {
      password: NEW_PASSWORD,
      currentPassword: 'Wrong-Password-00'
    });

    expect(res.status).toBe(403);
    expect(stepUpFailures('user@example.com')).toHaveLength(before);
  });

  it('rejects a malformed code before the lookup, as the ValidationPipe does', async () => {
    const token = await login('admin@example.com');

    const res = await patch(token, '00000000-0000-4000-8000-000000000000', {
      password: NEW_PASSWORD,
      code: '12'
    });

    expect(res.status).toBe(400);
  });

  it('accepts the change with the current password and keeps it out of the audit', async () => {
    const token = await login('user@example.com');
    const self = findUserByEmail('user@example.com')!;

    const res = await patch(token, self.id, {
      password: NEW_PASSWORD,
      currentPassword: SEED_PASSWORD
    });

    expect(res.status).toBe(200);
    expect(self.password).toBe(NEW_PASSWORD);
    const update = getState()
      .auditLogs.filter((row) => row.action === 'USER_UPDATE')
      .at(-1);
    expect(update?.details).toEqual({ changedFields: [] });
  });
});
