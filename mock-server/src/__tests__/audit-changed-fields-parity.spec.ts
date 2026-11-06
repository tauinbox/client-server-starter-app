import type { Server } from 'http';
import { versionEtag } from '@app/shared/utils/if-match';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';
import { mockId } from '../utils/mock-id';

// Mirrors server/test/audit-changed-fields.e2e-spec.ts: the audit row lists
// the fields whose stored value changed, not the keys of the request.

let server: Server;
let baseUrl: string;
let token: string;

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(async () => {
  resetState();
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });

  expect(res.status).toBe(200);
  token = ((await res.json()) as { tokens: { access_token: string } }).tokens
    .access_token;
});

async function send<T>(
  method: string,
  path: string,
  {
    body,
    expected,
    ifMatch
  }: { body: object; expected: number; ifMatch?: number }
): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`
  };

  if (ifMatch !== undefined) headers['if-match'] = versionEtag(ifMatch);

  const res = await fetch(`${baseUrl}/api/v1/${path}`, {
    method,
    headers,
    body: JSON.stringify(body)
  });

  expect(res.status).toBe(expected);

  return (await res.json()) as T;
}

function lastChangedFields(action: string, targetId: string): unknown {
  const row = getState()
    .auditLogs.filter((r) => r.action === action && r.targetId === targetId)
    .at(-1);

  return row?.details?.['changedFields'];
}

describe('audit changedFields parity', () => {
  it('feature flag: a resubmit logs [] and a description edit logs ["description"]', async () => {
    const flag = await send<{
      id: string;
      version: number;
      environments: string[];
      public: boolean;
    }>('POST', 'admin/feature-flags', {
      body: { key: 'audit-fields-flag', description: 'old', enabled: true },
      expected: 201
    });
    const form = {
      description: 'old',
      enabled: true,
      environments: flag.environments,
      public: flag.public
    };

    await send('PATCH', `admin/feature-flags/${flag.id}`, {
      body: form,
      expected: 200,
      ifMatch: 1
    });
    expect(lastChangedFields('FEATURE_FLAG_UPDATE', flag.id)).toEqual([]);

    await send('PATCH', `admin/feature-flags/${flag.id}`, {
      body: { ...form, description: 'new' },
      expected: 200,
      ifMatch: 2
    });
    expect(lastChangedFields('FEATURE_FLAG_UPDATE', flag.id)).toEqual([
      'description'
    ]);
  });

  it('role: a resubmit logs [] and a description edit logs ["description"]', async () => {
    const role = await send<{ id: string }>('POST', 'roles', {
      body: { name: 'audit-fields-role', description: 'old' },
      expected: 201
    });

    await send('PATCH', `roles/${role.id}`, {
      body: { name: 'audit-fields-role', description: 'old' },
      expected: 200
    });
    expect(lastChangedFields('ROLE_UPDATE', role.id)).toEqual([]);

    await send('PATCH', `roles/${role.id}`, {
      body: { name: 'audit-fields-role', description: 'new' },
      expected: 200
    });
    expect(lastChangedFields('ROLE_UPDATE', role.id)).toEqual(['description']);
  });

  it('resource: a resubmit logs [] and a description edit logs ["description"]', async () => {
    const resource = getState()
      .resources.values()
      .find((r) => r.name === 'users')!;
    const form = {
      displayName: resource.displayName,
      description: resource.description,
      allowedActionNames: resource.allowedActionNames
    };

    await send('PATCH', `rbac/resources/${resource.id}`, {
      body: form,
      expected: 200
    });
    expect(lastChangedFields('RESOURCE_UPDATE', resource.id)).toEqual([]);

    await send('PATCH', `rbac/resources/${resource.id}`, {
      body: { ...form, description: 'changed' },
      expected: 200
    });
    expect(lastChangedFields('RESOURCE_UPDATE', resource.id)).toEqual([
      'description'
    ]);
  });

  it('user: a resubmit logs [] and a name edit logs ["name"]', async () => {
    const id = mockId('user-3');
    const user = getState().users.get(id)!;
    const form = {
      email: user.email,
      name: user.name,
      isActive: user.isActive
    };

    await send('PATCH', `users/${id}`, { body: form, expected: 200 });
    expect(lastChangedFields('USER_UPDATE', id)).toEqual([]);

    await send('PATCH', `users/${id}`, {
      body: { ...form, name: 'Renamed' },
      expected: 200
    });
    expect(lastChangedFields('USER_UPDATE', id)).toEqual(['name']);
  });

  it('user: unlockAccount is listed only for a locked account', async () => {
    const id = mockId('user-3');
    const user = getState().users.get(id)!;

    await send('PATCH', `users/${id}`, {
      body: { unlockAccount: true },
      expected: 200
    });
    expect(lastChangedFields('USER_UPDATE', id)).toEqual([]);

    user.failedLoginAttempts = 5;
    user.lockedUntil = new Date(Date.now() + 60_000).toISOString();
    await send('PATCH', `users/${id}`, {
      body: { unlockAccount: true },
      expected: 200
    });
    expect(lastChangedFields('USER_UPDATE', id)).toEqual(['unlockAccount']);
  });
});
