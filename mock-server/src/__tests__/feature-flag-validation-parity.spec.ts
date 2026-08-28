import type { Server } from 'http';
import { APP_ENVIRONMENTS } from '@app/shared/constants';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { getState, resetState } from '../state';

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

async function loginAsAdmin(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function createFlag(body: unknown): Promise<Response> {
  const token = await loginAsAdmin();
  return fetch(`${baseUrl}/api/v1/admin/feature-flags`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
}

async function replaceRules(flagId: string, rules: unknown): Promise<Response> {
  const token = await loginAsAdmin();
  return fetch(`${baseUrl}/api/v1/admin/feature-flags/${flagId}/rules`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ rules })
  });
}

// Mirrors the server DTO and validateRulePayload: an environment the server
// cannot run as, and an attribute value the evaluator cannot compare, are both
// rejected instead of being stored as a permanently inert rule.
describe('feature-flag validation parity with server', () => {
  describe('environments', () => {
    it('trims, lowercases and de-duplicates', async () => {
      const res = await createFlag({
        key: 'env-normalize',
        environments: [' Production ', 'STAGING', 'production']
      });
      expect(res.status).toBe(201);
      const flag = (await res.json()) as { environments: string[] };
      expect(flag.environments).toEqual(['production', 'staging']);
    });

    it('accepts every deployable environment name', async () => {
      const res = await createFlag({
        key: 'env-all',
        environments: [...APP_ENVIRONMENTS]
      });
      expect(res.status).toBe(201);
    });

    it('rejects a name the server can never run as', async () => {
      const res = await createFlag({ key: 'env-bad', environments: ['qa'] });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toContain('environment');
    });

    it('applies the same rules on PATCH', async () => {
      const created = await createFlag({ key: 'env-patch' });
      expect(created.status).toBe(201);
      const flag = (await created.json()) as { id: string; version: number };
      const token = await loginAsAdmin();

      const res = await fetch(
        `${baseUrl}/api/v1/admin/feature-flags/${flag.id}`,
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            'if-match': String(flag.version)
          },
          body: JSON.stringify({ environments: ['qa'] })
        }
      );
      expect(res.status).toBe(400);
    });
  });

  describe('attribute rule value', () => {
    let flagId = '';

    async function ruleResponse(op: string, value: unknown): Promise<Response> {
      const created = await createFlag({ key: `attr-${op.toLowerCase()}` });
      expect(created.status).toBe(201);
      const flag = (await created.json()) as { id: string };
      flagId = flag.id;
      return replaceRules(flag.id, [
        {
          type: 'attribute',
          effect: 'include',
          payload: { type: 'attribute', field: 'email', op, value }
        }
      ]);
    }

    it('accepts a scalar for op=eq', async () => {
      expect((await ruleResponse('eq', 'a@b.com')).status).toBe(200);
    });

    it('rejects an object for op=eq', async () => {
      const res = await ruleResponse('eq', { nested: true });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toContain('op=eq');
      expect(
        getState().featureFlagRules.filter((r) => r.flagId === flagId)
      ).toHaveLength(0);
    });

    it('rejects an empty array for op=in', async () => {
      expect((await ruleResponse('in', [])).status).toBe(400);
    });

    it('rejects an empty string for op=endsWith', async () => {
      expect((await ruleResponse('endsWith', '')).status).toBe(400);
    });

    it('rejects an unparseable date for op=before', async () => {
      expect((await ruleResponse('before', 'not-a-date')).status).toBe(400);
    });

    it('accepts an ISO date for op=after', async () => {
      expect((await ruleResponse('after', '2026-01-01T00:00:00Z')).status).toBe(
        200
      );
    });
  });

  // The preview body may carry an unsaved rule set, an unsaved enabled state
  // and an unsaved environment list. The server evaluates those instead of the
  // stored flag, and runs the same rule-payload validator as the save path.
  describe('preview draft state', () => {
    let flagId: string;

    async function preview(body: unknown): Promise<Response> {
      const token = await loginAsAdmin();
      return fetch(`${baseUrl}/api/v1/admin/feature-flags/${flagId}/preview`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
    }

    beforeEach(async () => {
      const created = await createFlag({
        key: 'preview-draft',
        enabled: true
      });
      expect(created.status).toBe(201);
      flagId = ((await created.json()) as { id: string }).id;
      const stored = await replaceRules(flagId, [
        {
          type: 'role',
          effect: 'include',
          payload: { type: 'role', roleNames: ['beta'] }
        }
      ]);
      expect(stored.status).toBe(200);
    });

    it('evaluates the stored rules when no draft rules are sent', async () => {
      const res = await preview({ roles: ['beta'] });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        result: true,
        reason: 'included-by-rule'
      });
    });

    it('evaluates the supplied rules instead of the stored ones', async () => {
      const res = await preview({
        roles: ['beta'],
        rules: [
          {
            type: 'role',
            effect: 'include',
            payload: { type: 'role', roleNames: ['gamma'] }
          }
        ]
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        result: false,
        matchedRule: null
      });
    });

    it('matches a supplied rule the stored set does not contain', async () => {
      const res = await preview({
        roles: ['gamma'],
        rules: [
          {
            type: 'role',
            effect: 'include',
            payload: { type: 'role', roleNames: ['gamma'] }
          }
        ]
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        result: true,
        reason: 'included-by-rule',
        matchedRule: { index: 0, type: 'role', effect: 'include' }
      });
    });

    it('rejects a supplied payload the save path also rejects', async () => {
      const rules = [
        {
          type: 'user',
          effect: 'include',
          payload: { type: 'user', userIds: 'not-an-array' }
        }
      ];
      const previewRes = await preview({ rules });
      const saveRes = await replaceRules(flagId, rules);
      expect(previewRes.status).toBe(400);
      expect(saveRes.status).toBe(400);
      const previewBody = (await previewRes.json()) as { message: string };
      const saveBody = (await saveRes.json()) as { message: string };
      expect(previewBody.message).toBe(saveBody.message);
    });

    it('rejects a non-array rule set before the flag lookup', async () => {
      const token = await loginAsAdmin();
      const res = await fetch(
        `${baseUrl}/api/v1/admin/feature-flags/00000000-0000-4000-8000-000000000000/preview`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ rules: 'nope' })
        }
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors: string[] };
      expect(body.errors).toContain('rules must be an array');
    });

    it('evaluates a supplied enabled state instead of the stored one', async () => {
      const res = await preview({ roles: ['beta'], enabled: false });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        result: false,
        reason: 'disabled'
      });
    });

    it('rejects a non-boolean enabled', async () => {
      const res = await preview({ enabled: 'yes' });
      expect(res.status).toBe(400);
    });

    it('evaluates a supplied environment list instead of the stored one', async () => {
      const res = await preview({ roles: ['beta'], environments: ['staging'] });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        result: false,
        reason: 'env-mismatch'
      });
    });

    it('rejects an environment the server can never run as', async () => {
      const res = await preview({ environments: ['qa'] });
      expect(res.status).toBe(400);
    });

    it('writes nothing while previewing a draft', async () => {
      await preview({
        roles: ['gamma'],
        enabled: false,
        environments: ['staging'],
        rules: [
          {
            type: 'role',
            effect: 'include',
            payload: { type: 'role', roleNames: ['gamma'] }
          }
        ]
      });
      const stored = getState().featureFlagRules.filter(
        (r) => r.flagId === flagId
      );
      expect(stored).toHaveLength(1);
      expect(stored[0].payload).toEqual({ type: 'role', roleNames: ['beta'] });
      expect(getState().featureFlags.get(flagId)?.enabled).toBe(true);
    });
  });
});
