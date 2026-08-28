import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import type { MockAuditLog } from '../types';

let server: Server;
let baseUrl: string;
let accessToken: string;

beforeAll(async () => {
  resetState();
  const app = createApp();
  server = await listenOnUnblockedPort(app);
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(async () => {
  resetState();
  const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  const { tokens } = (await login.json()) as {
    tokens: { access_token: string };
  };
  accessToken = tokens.access_token;
});

function call(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function auditRows(action: string): MockAuditLog[] {
  return getState().auditLogs.filter((row) => row.action === action);
}

describe('delete audit details parity', () => {
  it('records the flag key on FEATURE_FLAG_DELETE', async () => {
    const created = await call('POST', '/api/v1/admin/feature-flags', {
      key: 'audit-probe-flag'
    });
    expect(created.status).toBe(201);
    const flag = (await created.json()) as { id: string };

    expect(
      (await call('DELETE', `/api/v1/admin/feature-flags/${flag.id}`)).status
    ).toBe(204);

    const rows = auditRows('FEATURE_FLAG_DELETE');
    expect(rows).toHaveLength(1);
    expect(rows[0].targetType).toBe('FeatureFlag');
    expect(rows[0].details).toEqual({ key: 'audit-probe-flag' });
  });

  it('records the role name on ROLE_DELETE', async () => {
    const created = await call('POST', '/api/v1/roles', {
      name: 'audit-probe-role'
    });
    expect(created.status).toBe(201);
    const role = (await created.json()) as { id: string; name: string };

    expect((await call('DELETE', `/api/v1/roles/${role.id}`)).status).toBe(200);

    const rows = auditRows('ROLE_DELETE');
    expect(rows).toHaveLength(1);
    expect(rows[0].targetType).toBe('Role');
    expect(rows[0].details).toEqual({ name: role.name });
  });

  it('records the action name on ACTION_DELETE', async () => {
    const created = await call('POST', '/api/v1/rbac/actions', {
      name: 'auditprobe',
      displayName: 'Audit Probe'
    });
    expect(created.status).toBe(201);
    const action = (await created.json()) as { id: string; name: string };

    expect(
      (await call('DELETE', `/api/v1/rbac/actions/${action.id}`)).status
    ).toBe(200);

    const rows = auditRows('ACTION_DELETE');
    expect(rows).toHaveLength(1);
    expect(rows[0].targetType).toBe('Action');
    expect(rows[0].details).toEqual({ name: action.name });
  });
});
