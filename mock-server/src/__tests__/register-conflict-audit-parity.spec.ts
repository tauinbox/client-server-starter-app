import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockAuditLog } from '../types';

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

function auditRows(action: string): MockAuditLog[] {
  return getState().auditLogs.filter((row) => row.action === action);
}

function register(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

const validBody = {
  email: 'taken@example.com',
  password: 'Sunrise-Kettle-19',
  firstName: 'Conflict',
  lastName: 'Probe'
};

describe('register conflict audit parity', () => {
  it('audits a conflict against an existing address and keeps the 409 body', async () => {
    expect((await register(validBody)).status).toBe(201);

    const conflict = await register(validBody);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      message: 'User with this email already exists',
      statusCode: 409,
      errorKey: 'errors.users.emailExists'
    });

    const rows = auditRows('USER_REGISTER_CONFLICT');
    expect(rows).toHaveLength(1);
    expect(rows[0].actorEmail).toBe('taken@example.com');
    expect(auditRows('USER_REGISTER')).toHaveLength(1);
  });

  it('normalizes the logged address the way the DTO transform does', async () => {
    await register(validBody);

    expect(
      (await register({ ...validBody, email: '  TAKEN@Example.COM ' })).status
    ).toBe(409);

    expect(auditRows('USER_REGISTER_CONFLICT')[0].actorEmail).toBe(
      'taken@example.com'
    );
  });

  it('does not audit a validation failure', async () => {
    expect((await register({ ...validBody, password: 'weak' })).status).toBe(
      400
    );

    expect(auditRows('USER_REGISTER_CONFLICT')).toHaveLength(0);
  });

  it('does not audit the admin create route, which shares the helper', async () => {
    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@example.com',
        password: 'Password1'
      })
    });
    const { tokens } = (await login.json()) as {
      tokens: { access_token: string };
    };

    const created = await fetch(`${baseUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${tokens.access_token}`
      },
      body: JSON.stringify({ ...validBody, email: 'admin@example.com' })
    });
    expect(created.status).toBe(409);

    expect(auditRows('USER_REGISTER_CONFLICT')).toHaveLength(0);
  });
});
