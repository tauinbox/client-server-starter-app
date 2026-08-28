import type { Server } from 'http';
import { APP_ENVIRONMENTS, ErrorKeys } from '@app/shared/constants';
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

async function patchFlag(
  flagId: string,
  body: unknown,
  ifMatch?: string
): Promise<Response> {
  const token = await loginAsAdmin();
  return fetch(`${baseUrl}/api/v1/admin/feature-flags/${flagId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(ifMatch === undefined ? {} : { 'if-match': ifMatch })
    },
    body: JSON.stringify(body)
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

  // Every message below was measured by running the body through
  // `PreviewFlagContextDto` with the `main.ts` ValidationPipe options. The mock
  // used to coerce these values instead, so a context that worked here returned
  // 400 against the real server.
  describe('preview context validation', () => {
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

    async function errorsOf(body: unknown): Promise<string[]> {
      const res = await preview(body);
      expect(res.status).toBe(400);
      return ((await res.json()) as { errors: string[] }).errors;
    }

    beforeEach(async () => {
      const created = await createFlag({
        key: 'preview-context',
        enabled: true
      });
      expect(created.status).toBe(201);
      flagId = ((await created.json()) as { id: string }).id;
    });

    it('reports the unknown property and both field failures together', async () => {
      await expect(
        errorsOf({ userId: 'not-a-uuid', bogusProp: 1, roles: 'admin' })
      ).resolves.toEqual([
        'property bogusProp should not exist',
        'userId must be a UUID',
        'roles must contain no more than 32 elements',
        'roles must be an array'
      ]);
    });

    it('rejects a userId that is not a UUID', async () => {
      await expect(errorsOf({ userId: 'not-a-uuid' })).resolves.toEqual([
        'userId must be a UUID'
      ]);
    });

    // `@IsUUID()` constrains the version and variant nibbles; the pattern
    // ParseUUIDPipe applies to the `:id` route param does not.
    it('rejects a body userId the route param pattern would accept', async () => {
      await expect(
        errorsOf({ userId: '11111111-1111-1111-1111-111111111111' })
      ).resolves.toEqual(['userId must be a UUID']);
    });

    it('rejects a non-array roles', async () => {
      await expect(errorsOf({ roles: 5 })).resolves.toEqual([
        'each value in roles must be shorter than or equal to 64 characters',
        'each value in roles must be a string',
        'roles must contain no more than 32 elements',
        'roles must be an array'
      ]);
    });

    it('rejects more than 32 roles', async () => {
      const roles = Array.from({ length: 33 }, () => 'beta');
      await expect(errorsOf({ roles })).resolves.toEqual([
        'roles must contain no more than 32 elements'
      ]);
    });

    it('rejects a role name over 64 characters', async () => {
      await expect(errorsOf({ roles: ['r'.repeat(65)] })).resolves.toEqual([
        'each value in roles must be shorter than or equal to 64 characters'
      ]);
    });

    it('rejects a non-object attributes', async () => {
      await expect(errorsOf({ attributes: 'nope' })).resolves.toEqual([
        'attributes must be an object'
      ]);
      await expect(errorsOf({ attributes: [1, 2] })).resolves.toEqual([
        'attributes must be an object'
      ]);
    });

    it('rejects an env over 32 characters', async () => {
      await expect(errorsOf({ env: 'e'.repeat(33) })).resolves.toEqual([
        'env must be shorter than or equal to 32 characters'
      ]);
    });

    it('rejects a non-string env', async () => {
      await expect(errorsOf({ env: 7 })).resolves.toEqual([
        'env must be shorter than or equal to 32 characters',
        'env must be a string'
      ]);
    });

    it('rejects an anonId over 128 characters', async () => {
      await expect(errorsOf({ anonId: 'a'.repeat(129) })).resolves.toEqual([
        'anonId must be shorter than or equal to 128 characters'
      ]);
    });

    it('rejects an unknown property on its own', async () => {
      await expect(errorsOf({ bogusProp: 1 })).resolves.toEqual([
        'property bogusProp should not exist'
      ]);
    });

    it('reports the context fields before the draft fields', async () => {
      await expect(
        errorsOf({ enabled: 'yes', userId: 'not-a-uuid' })
      ).resolves.toEqual([
        'userId must be a UUID',
        'enabled must be a boolean value'
      ]);
    });

    // `@IsOptional()` skips the remaining validators for an explicit null.
    it('accepts an explicit null for every optional context field', async () => {
      const res = await preview({
        userId: null,
        roles: null,
        attributes: null,
        env: null,
        anonId: null
      });
      expect(res.status).toBe(200);
    });

    it('accepts a well-formed context', async () => {
      const res = await preview({
        userId: '123e4567-e89b-12d3-a456-426614174000',
        roles: ['beta'],
        attributes: { email: 'tester@example.com' },
        env: 'staging',
        anonId: 'anon-42'
      });
      expect(res.status).toBe(200);
    });

    // sanitizeAttributes drops an over-long key instead of rejecting it.
    it('drops an over-long attribute key without rejecting the request', async () => {
      const res = await preview({
        attributes: { ['k'.repeat(65)]: 1, email: 'tester@example.com' }
      });
      expect(res.status).toBe(200);
    });

    // The server slices the first 32 entries and only then drops the bad keys,
    // so a dropped key still consumes one of the 32 slots.
    it('counts a dropped attribute key against the 32-entry cap', async () => {
      const stored = await replaceRules(flagId, [
        {
          type: 'attribute',
          effect: 'include',
          payload: {
            type: 'attribute',
            field: 'email',
            op: 'eq',
            value: 'tester@example.com'
          }
        }
      ]);
      expect(stored.status).toBe(200);

      const attributes: Record<string, unknown> = { ['k'.repeat(65)]: 1 };
      for (let i = 0; i < 31; i++) attributes[`k${i}`] = i;
      attributes['email'] = 'tester@example.com';

      const res = await preview({ attributes });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        result: false,
        matchedRule: null
      });
    });
  });

  // The server runs the global ValidationPipe before the handler body, so a DTO
  // failure precedes the If-Match parse and both precede the service lookup.
  // The rule-payload validator is the exception: it runs inside replaceRules,
  // after findOne has already thrown the 404.
  describe('rejection order', () => {
    const ABSENT_ID = '11111111-1111-4111-8111-111111111111';

    it('rejects a bad PATCH body on an absent flag with 400, not 404', async () => {
      const res = await patchFlag(ABSENT_ID, { enabled: 'yes' });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors: string[] };
      expect(body.errors[0]).toContain('enabled');
    });

    it('rejects a bad PATCH body with 400 before the missing If-Match', async () => {
      const created = await createFlag({ key: 'order-patch-body' });
      const flag = (await created.json()) as { id: string };
      const res = await patchFlag(flag.id, { enabled: 'yes' });
      expect(res.status).toBe(400);
    });

    it('still answers 428 for a valid PATCH body with no If-Match on an absent flag', async () => {
      const res = await patchFlag(ABSENT_ID, { enabled: true });
      expect(res.status).toBe(428);
      const body = (await res.json()) as { errorKey: string };
      expect(body.errorKey).toBe(ErrorKeys.FEATURE_FLAGS.IF_MATCH_REQUIRED);
    });

    it('reports the key conflict, not the version conflict, when a PATCH is both', async () => {
      const first = await createFlag({ key: 'order-taken-key' });
      const second = await createFlag({ key: 'order-stale-flag' });
      expect(first.status).toBe(201);
      const target = (await second.json()) as { id: string; version: number };

      const res = await patchFlag(
        target.id,
        { key: 'order-taken-key' },
        String(target.version + 5)
      );
      expect(res.status).toBe(409);
      const body = (await res.json()) as { errorKey: string };
      expect(body.errorKey).toBe(ErrorKeys.FEATURE_FLAGS.KEY_EXISTS);
    });

    it('rejects a non-array rule set on an absent flag with 400, not 404', async () => {
      const res = await replaceRules(ABSENT_ID, 'nope');
      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors: string[] };
      expect(body.errors).toContain('rules must be an array');
    });

    it('rejects a non-object rule payload on an absent flag with 400, not 404', async () => {
      const res = await replaceRules(ABSENT_ID, [
        { type: 'user', effect: 'include', payload: 'nope' }
      ]);
      expect(res.status).toBe(400);
    });

    it('answers 404 for a payload the rule validator rejects on an absent flag', async () => {
      const res = await replaceRules(ABSENT_ID, [
        { type: 'user', effect: 'include', payload: { type: 'user' } }
      ]);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { errorKey: string };
      expect(body.errorKey).toBe(ErrorKeys.FEATURE_FLAGS.NOT_FOUND);
    });
  });
});
