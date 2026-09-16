import type { Server } from 'http';
import { MAX_PASSWORD_LENGTH } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, logAudit, resetState } from '../state';

// Mirrors LocalStrategy: the login route has no `@Body()`, so values over the
// `LoginDto` caps collapse to '' and stay a 401. The audit row must not carry
// the oversized address.
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

function postLogin(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function loginFailures() {
  return getState().auditLogs.filter(
    (row) => row.action === 'USER_LOGIN_FAILURE'
  );
}

describe('POST /api/v1/auth/login length caps', () => {
  it('answers 401 and audits an empty address for one over 255 characters', async () => {
    const res = await postLogin({
      email: `${'a'.repeat(10_000)}@example.com`,
      password: 'Password1'
    });

    expect(res.status).toBe(401);
    const rows = loginFailures();
    expect(rows).toHaveLength(1);
    expect(rows[0].actorEmail).toBe('');
  });

  it(`refuses the right password when it is over ${MAX_PASSWORD_LENGTH} characters`, async () => {
    const user = [...getState().users.values()].find(
      (u) => u.email === 'user@example.com'
    );
    if (!user) throw new Error('seed user missing');
    const longPassword = 'a'.repeat(MAX_PASSWORD_LENGTH + 1);
    user.password = longPassword;

    const res = await postLogin({
      email: 'user@example.com',
      password: longPassword
    });

    expect(res.status).toBe(401);
  });

  it(`accepts a stored password of ${MAX_PASSWORD_LENGTH} astral characters`, async () => {
    const user = [...getState().users.values()].find(
      (u) => u.email === 'user@example.com'
    );
    if (!user) throw new Error('seed user missing');
    const password = '\u{1F600}'.repeat(MAX_PASSWORD_LENGTH);
    user.password = password;

    const res = await postLogin({ email: 'user@example.com', password });

    expect(res.status).toBe(200);
  });
});

// Mirrors AuditService.log, which caps every string column at 255.
describe('logAudit field caps', () => {
  it('stores at most 255 characters in each string field', () => {
    const long = 'x'.repeat(1000);
    logAudit('USER_LOGIN_FAILURE', {
      actorEmail: long,
      targetId: long,
      targetType: long,
      ip: long,
      requestId: long
    });

    const row = getState().auditLogs.at(-1);
    expect(row?.actorEmail).toHaveLength(255);
    expect(row?.targetId).toHaveLength(255);
    expect(row?.targetType).toHaveLength(255);
    expect(row?.ipAddress).toHaveLength(255);
    expect(row?.requestId).toHaveLength(255);
  });
});
