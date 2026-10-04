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

// Saves a full rule set through PATCH at the current version. An absent flag
// gets version 1, so the request reaches the lookup instead of stopping at 428.
async function saveRules(flagId: string, rules: unknown): Promise<Response> {
  const token = await loginAsAdmin();
  const current = await fetch(
    `${baseUrl}/api/v1/admin/feature-flags/${flagId}`,
    {
      headers: { authorization: `Bearer ${token}` }
    }
  );
  const version = current.ok
    ? ((await current.json()) as { version: number }).version
    : 1;
  return patchFlag(flagId, { rules }, String(version));
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
  describe('key', () => {
    it('trims surrounding whitespace before validating', async () => {
      const res = await createFlag({ key: '  probe-trim  ' });
      expect(res.status).toBe(201);
      const flag = (await res.json()) as { key: string };
      expect(flag.key).toBe('probe-trim');
    });

    it('compares the trimmed key against the existing flags', async () => {
      const created = await createFlag({ key: 'dup-trim' });
      expect(created.status).toBe(201);

      const res = await createFlag({ key: ' dup-trim ' });
      expect(res.status).toBe(409);
    });

    it('rejects a key on PATCH with 400 and keeps the flag unchanged', async () => {
      const created = await createFlag({ key: 'patch-stable-key' });
      const target = (await created.json()) as { id: string; version: number };

      const res = await patchFlag(
        target.id,
        { key: 'patch-renamed-key', enabled: true },
        String(target.version)
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors: string[] };
      expect(body.errors).toEqual(['property key should not exist']);
      const flag = getState().featureFlags.get(target.id);
      expect(flag?.key).toBe('patch-stable-key');
      expect(flag?.version).toBe(target.version);
    });

    it('rejects a key that is only whitespace', async () => {
      const res = await createFlag({ key: '   ' });
      expect(res.status).toBe(400);
    });

    it('rejects a whitespace-only key on PATCH', async () => {
      const created = await createFlag({ key: 'patch-blank' });
      expect(created.status).toBe(201);
      const flag = (await created.json()) as { id: string; version: number };

      const res = await patchFlag(
        flag.id,
        { key: '   ' },
        String(flag.version)
      );
      expect(res.status).toBe(400);
    });
  });

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

  // The mock runs the same shared rule-payload parser as the server, so the
  // value rules are covered by its server spec. These cases pin the response
  // envelope: the server text with no prefix, and nothing stored on rejection.
  describe('rule payload rejection', () => {
    async function ruleResponse(
      key: string,
      rule: unknown
    ): Promise<{ res: Response; flagId: string }> {
      const created = await createFlag({ key });
      expect(created.status).toBe(201);
      const flag = (await created.json()) as { id: string };
      return { res: await saveRules(flag.id, [rule]), flagId: flag.id };
    }

    it('returns the server text for an unregistered customKey', async () => {
      const { res, flagId } = await ruleResponse('payload-custom-key', {
        type: 'attribute',
        effect: 'include',
        payload: {
          type: 'attribute',
          field: 'custom',
          customKey: 'nope',
          op: 'eq',
          value: true
        }
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe(
        'customKey "nope" is not registered in the attribute registry'
      );
      expect(
        getState().featureFlagRules.filter((r) => r.flagId === flagId)
      ).toHaveLength(0);
    });

    it('returns the server text for an out-of-range percent', async () => {
      const { res } = await ruleResponse('payload-percent', {
        type: 'percentage',
        effect: 'include',
        payload: { type: 'percentage', percent: 500 }
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe(
        'percentage rule requires percent: an integer in [0, 100]'
      );
    });

    it.each([
      [
        'a fractional percent',
        { type: 'percentage', percent: 0.5 },
        'percentage rule requires percent: an integer in [0, 100]'
      ],
      [
        'a non-UUID user id',
        { type: 'user', userIds: ['not-a-uuid'] },
        'user rule requires userIds: an array of up to 100 UUIDs'
      ],
      [
        'a role name over the cap',
        { type: 'role', roleNames: ['x'.repeat(101)] },
        'role rule requires roleNames: an array of up to 32 names of 1-100 characters'
      ]
    ])('returns the server text for %s', async (_label, payload, message) => {
      const { res, flagId } = await ruleResponse(
        `payload-${payload.type}-bad`,
        { type: payload.type, effect: 'include', payload }
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe(message);
      expect(
        getState().featureFlagRules.filter((r) => r.flagId === flagId)
      ).toHaveLength(0);
    });

    it('returns the server text for a field and operator that never match', async () => {
      const { res, flagId } = await ruleResponse('payload-created-eq', {
        type: 'attribute',
        effect: 'include',
        payload: {
          type: 'attribute',
          field: 'createdAt',
          op: 'eq',
          value: '2026-01-01T00:00:00.000Z'
        }
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe(
        'attribute rule with field=createdAt does not support op=eq'
      );
      expect(
        getState().featureFlagRules.filter((r) => r.flagId === flagId)
      ).toHaveLength(0);
    });

    it('stores percentage bucketBy=device', async () => {
      const { res } = await ruleResponse('payload-bucket-device', {
        type: 'percentage',
        effect: 'include',
        payload: { type: 'percentage', percent: 10, bucketBy: 'device' }
      });
      expect(res.status).toBe(200);
      const flag = (await res.json()) as {
        rules: { payload: Record<string, unknown> }[];
      };
      expect(flag.rules[0]?.payload).toEqual({
        type: 'percentage',
        percent: 10,
        bucketBy: 'device'
      });
    });
  });

  // The server resolves createdAt to a Date, so `eq` never matches it and only
  // a date comparison does. A row stored before the pair check still loads.
  describe('createdAt evaluation', () => {
    async function flagsAsUser(): Promise<Record<string, boolean>> {
      const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'Password1'
        })
      });
      expect(login.status).toBe(200);
      const { tokens } = (await login.json()) as {
        tokens: { access_token: string };
      };
      const res = await fetch(`${baseUrl}/api/v1/feature-flags`, {
        headers: { authorization: `Bearer ${tokens.access_token}` }
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { flags: Record<string, boolean> }).flags;
    }

    function userCreatedAt(): string {
      const user = [...getState().users.values()].find(
        (u) => u.email === 'user@example.com'
      );
      if (!user) throw new Error('seed user missing');
      return user.createdAt;
    }

    it('matches an after rule for the user', async () => {
      const dayBefore = new Date(
        new Date(userCreatedAt()).getTime() - 24 * 60 * 60 * 1000
      ).toISOString();
      const created = await createFlag({ key: 'created-after', enabled: true });
      const flag = (await created.json()) as { id: string };
      const res = await saveRules(flag.id, [
        {
          type: 'attribute',
          effect: 'include',
          payload: {
            type: 'attribute',
            field: 'createdAt',
            op: 'after',
            value: dayBefore
          }
        }
      ]);
      expect(res.status).toBe(200);

      await expect(flagsAsUser()).resolves.toMatchObject({
        'created-after': true
      });
    });

    it('never matches a stored eq rule, as on the server', async () => {
      const created = await createFlag({ key: 'created-eq', enabled: true });
      const flag = (await created.json()) as { id: string };
      const now = new Date().toISOString();
      getState().featureFlagRules.push({
        id: 'legacy-created-eq',
        flagId: flag.id,
        type: 'attribute',
        effect: 'include',
        payload: {
          type: 'attribute',
          field: 'createdAt',
          op: 'eq',
          value: userCreatedAt()
        },
        createdAt: now,
        updatedAt: now
      });

      const flags = await flagsAsUser();
      expect('created-eq' in flags).toBe(false);
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
      const stored = await saveRules(flagId, [
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
      const saveRes = await saveRules(flagId, rules);
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
        'each value in roles must be shorter than or equal to 100 characters',
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

    it('accepts a role name of the role-name cap', async () => {
      const res = await preview({ roles: ['r'.repeat(100)] });
      expect(res.status).toBe(200);
    });

    it('rejects a role name over 100 characters', async () => {
      await expect(errorsOf({ roles: ['r'.repeat(101)] })).resolves.toEqual([
        'each value in roles must be shorter than or equal to 100 characters'
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
      const stored = await saveRules(flagId, [
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
  // The rule-payload validator is the exception: the service runs it after
  // the lookups (404 on PATCH, 409 for a taken key on POST) and before the
  // version check, so a rejected rule on a stale version is a 400.
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

    it('rejects a non-array rule set on an absent flag with 400, not 404', async () => {
      const res = await saveRules(ABSENT_ID, 'nope');
      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors: string[] };
      expect(body.errors).toContain('rules must be an array');
    });

    it('rejects a non-object rule payload on an absent flag with 400, not 404', async () => {
      const res = await saveRules(ABSENT_ID, [
        { type: 'user', effect: 'include', payload: 'nope' }
      ]);
      expect(res.status).toBe(400);
    });

    it('answers 404 for a payload the rule validator rejects on an absent flag', async () => {
      const res = await saveRules(ABSENT_ID, [
        { type: 'user', effect: 'include', payload: { type: 'user' } }
      ]);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { errorKey: string };
      expect(body.errorKey).toBe(ErrorKeys.FEATURE_FLAGS.NOT_FOUND);
    });

    it('answers 400 for a rejected rule payload on a stale version, not 409', async () => {
      const created = await createFlag({ key: 'order-stale-rules' });
      const flag = (await created.json()) as { id: string };
      const res = await patchFlag(
        flag.id,
        { rules: [{ type: 'user', effect: 'include', payload: {} }] },
        '7'
      );
      expect(res.status).toBe(400);
    });

    it('rejects a non-array rule set on a taken key with 400, not 409', async () => {
      await createFlag({ key: 'order-taken-key' });
      const res = await createFlag({ key: 'order-taken-key', rules: 'nope' });
      expect(res.status).toBe(400);
    });

    it('answers 409 for a rejected rule payload on a taken key', async () => {
      await createFlag({ key: 'order-taken-payload' });
      const res = await createFlag({
        key: 'order-taken-payload',
        rules: [{ type: 'user', effect: 'include', payload: { type: 'user' } }]
      });
      expect(res.status).toBe(409);
    });
  });

  describe('flag and rules save together', () => {
    const roleRule = (name: string) => ({
      type: 'role',
      effect: 'include',
      payload: { type: 'role', roleNames: [name] }
    });

    it('creates a flag with its rules in request order', async () => {
      const res = await createFlag({
        key: 'atomic-create',
        rules: [roleRule('a'), roleRule('b')]
      });
      expect(res.status).toBe(201);
      const flag = (await res.json()) as {
        version: number;
        rules: { payload: { roleNames: string[] } }[];
      };
      expect(flag.version).toBe(1);
      expect(flag.rules.map((r) => r.payload.roleNames)).toEqual([
        ['a'],
        ['b']
      ]);
    });

    it('creates no flag when a rule payload is rejected', async () => {
      const res = await createFlag({
        key: 'atomic-create-rejected',
        rules: [roleRule('a'), { type: 'user', effect: 'include', payload: {} }]
      });
      expect(res.status).toBe(400);
      const keys = [...getState().featureFlags.values()].map((f) => f.key);
      expect(keys).not.toContain('atomic-create-rejected');
    });

    it('changes nothing when a PATCH carries a rejected rule', async () => {
      const created = await createFlag({
        key: 'atomic-patch-rejected',
        rules: [roleRule('a')]
      });
      const flag = (await created.json()) as { id: string };
      const res = await patchFlag(
        flag.id,
        {
          enabled: true,
          rules: [
            roleRule('b'),
            { type: 'user', effect: 'include', payload: {} }
          ]
        },
        '1'
      );
      expect(res.status).toBe(400);
      const stored = getState().featureFlags.get(flag.id);
      expect(stored).toMatchObject({ enabled: false, version: 1 });
      const rules = getState().featureFlagRules.filter(
        (r) => r.flagId === flag.id
      );
      expect(rules.map((r) => r.payload)).toEqual([roleRule('a').payload]);
    });

    it('replaces the rules and bumps the version once', async () => {
      const created = await createFlag({
        key: 'atomic-patch',
        rules: [roleRule('a')]
      });
      const flag = (await created.json()) as { id: string };
      const res = await patchFlag(
        flag.id,
        { enabled: true, rules: [roleRule('b'), roleRule('c')] },
        '1'
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        enabled: boolean;
        version: number;
        rules: { payload: { roleNames: string[] } }[];
      };
      expect(body).toMatchObject({ enabled: true, version: 2 });
      expect(body.rules.map((r) => r.payload.roleNames)).toEqual([
        ['b'],
        ['c']
      ]);
    });

    it('keeps the rules when a PATCH carries none', async () => {
      const created = await createFlag({
        key: 'atomic-patch-keep',
        rules: [roleRule('a')]
      });
      const flag = (await created.json()) as { id: string };
      const res = await patchFlag(flag.id, { enabled: true }, '1');
      const body = (await res.json()) as { rules: unknown[] };
      expect(body.rules).toHaveLength(1);
    });
  });
});
