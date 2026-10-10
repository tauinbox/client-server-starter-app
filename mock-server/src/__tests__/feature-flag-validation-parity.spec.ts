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
        { effect: 'include', payload }
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

    // `@IsUUID()` constrains the version and variant nibbles.
    it('rejects a body userId with no RFC version or variant', async () => {
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

    // A save rejects such an environment too, so a preview that answered
    // env-mismatch for it would describe a flag that cannot exist.
    it.each(['prod', 7])('rejects the env %p', async (env) => {
      await expect(errorsOf({ env })).resolves.toEqual([
        'env must be one of the following values: local, development, staging, production'
      ]);
    });

    it.each(['anon-42', 7])('rejects the anonId %p', async (anonId) => {
      await expect(errorsOf({ anonId })).resolves.toEqual([
        'anonId must be a UUID'
      ]);
    });

    // The rollout cookie accepts any UUID shape, with no RFC version or variant.
    it('accepts an anonId of the rollout cookie shape', async () => {
      const res = await preview({
        anonId: '11111111-1111-1111-1111-111111111111'
      });
      expect(res.status).toBe(200);
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
        anonId: '0b6f2c1e-7d4a-4c1b-9e2f-3a5d8c7b6e10'
      });
      expect(res.status).toBe(200);
    });

    it('rejects an empty or over-long attribute key instead of dropping it', async () => {
      const message =
        'each key in attributes must be from 1 to 64 characters long';
      await expect(errorsOf({ attributes: { '': 1 } })).resolves.toEqual([
        message
      ]);
      await expect(
        errorsOf({
          attributes: { ['k'.repeat(65)]: 1, email: 'tester@example.com' }
        })
      ).resolves.toEqual([message]);
    });

    it('rejects 33 attribute keys instead of dropping the extra one', async () => {
      const attributes: Record<string, unknown> = {};
      for (let i = 0; i < 33; i++) attributes[`k${i}`] = i;
      await expect(errorsOf({ attributes })).resolves.toEqual([
        'attributes must contain no more than 32 keys'
      ]);
    });

    it('evaluates all 32 attribute keys', async () => {
      const stored = await saveRules(flagId, [
        {
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

      const attributes: Record<string, unknown> = { ['k'.repeat(64)]: 1 };
      for (let i = 0; i < 30; i++) attributes[`k${i}`] = i;
      attributes['email'] = 'tester@example.com';

      const res = await preview({ attributes });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        result: true,
        reason: 'included-by-rule'
      });
    });
  });

  // The expected lists are the server output: the same bodies were sent through
  // the application ValidationPipe on the three DTOs. The pipe reports every
  // failing field, and it keeps only the leaf messages of a nested error.
  describe('DTO error lists', () => {
    const ABSENT_ID = '22222222-2222-4222-8222-222222222222';
    const EFFECT = 'must be one of the following values: include, exclude';
    const ENVIRONMENT_ONE_OF =
      'each value in environments must be one of the following values: local, development, staging, production';
    const NESTED =
      'each value in nested property rules must be either object or array';
    const NOT_ARRAY = [
      'rules must contain no more than 64 elements',
      'rules must be an array',
      NESTED
    ];
    const validRule = {
      effect: 'include',
      payload: { type: 'role', roleNames: ['beta'] }
    };

    async function errorsOf(res: Response): Promise<string[]> {
      expect(res.status).toBe(400);
      return ((await res.json()) as { errors: string[] }).errors;
    }

    async function previewAbsent(body: unknown): Promise<Response> {
      const token = await loginAsAdmin();
      return fetch(
        `${baseUrl}/api/v1/admin/feature-flags/${ABSENT_ID}/preview`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
          },
          body: JSON.stringify(body)
        }
      );
    }

    it.each([
      [
        'every failing field',
        {
          description: 7,
          enabled: 'yes',
          environments: ['moon'],
          public: 'no',
          rules: [{ effect: 'include', payload: 'x' }]
        },
        [
          'description must be shorter than or equal to 500 characters',
          'description must be a string',
          'enabled must be a boolean value',
          ENVIRONMENT_ONE_OF,
          'public must be a boolean value',
          'rules.0.payload must be an object'
        ]
      ],
      [
        'an explicit null on each field',
        {
          description: null,
          enabled: null,
          environments: null,
          public: null,
          rules: null
        },
        [
          'enabled must be a boolean value',
          ENVIRONMENT_ONE_OF,
          'each value in environments must be a string',
          'environments must contain no more than 4 elements',
          'environments must be an array',
          'public must be a boolean value',
          ...NOT_ARRAY
        ]
      ],
      ['a string rule set', { rules: 'nope' }, NOT_ARRAY],
      [
        'every bad rule entry',
        {
          rules: [
            { effect: 'maybe', payload: {} },
            { effect: 'include', payload: null },
            { effect: 'include', payload: [] },
            {}
          ]
        },
        [
          `rules.0.effect ${EFFECT}`,
          'rules.1.payload must be an object',
          'rules.2.payload must be an object',
          `rules.3.effect ${EFFECT}`,
          'rules.3.payload must be an object'
        ]
      ],
      [
        'primitive rule entries, with no index in the path',
        { rules: [null, 5, 'x', [], {}] },
        [
          `rules.${NESTED}`,
          `rules.${NESTED}`,
          `rules.${NESTED}`,
          `rules.4.effect ${EFFECT}`,
          'rules.4.payload must be an object'
        ]
      ],
      [
        'only the bad entry of a rule set over the cap',
        { rules: [...Array.from({ length: 64 }, () => validRule), {}] },
        [`rules.64.effect ${EFFECT}`, 'rules.64.payload must be an object']
      ],
      [
        'a rule set over the cap',
        { rules: Array.from({ length: 65 }, () => validRule) },
        ['rules must contain no more than 64 elements']
      ],
      [
        'a valid rule sent as an object',
        { rules: validRule },
        [
          'rules must contain no more than 64 elements',
          'rules must be an array'
        ]
      ],
      [
        'an empty object sent as the rule set',
        { rules: {} },
        [`rules.effect ${EFFECT}`, 'rules.payload must be an object']
      ],
      [
        'nested rule arrays',
        { rules: [[validRule], [5], [{ effect: 'x' }]] },
        [
          `rules.1.${NESTED}`,
          `rules.2.0.effect ${EFFECT}`,
          'rules.2.0.payload must be an object'
        ]
      ],
      [
        'unknown rule properties ahead of the rule fields',
        {
          rules: [{ zeta: 1, effect: 'x', alpha: 2, type: 'role', payload: {} }]
        },
        [
          'rules.0.property zeta should not exist',
          'rules.0.property alpha should not exist',
          'rules.0.property type should not exist',
          `rules.0.effect ${EFFECT}`
        ]
      ],
      [
        'a rule-level type, which payload.type replaced',
        { rules: [{ ...validRule, type: 'role' }] },
        ['rules.0.property type should not exist']
      ],
      [
        'environments after normalization',
        {
          environments: [1, 'moon', ' Production ', 'production', 'x', 'y', 'z']
        },
        [
          ENVIRONMENT_ONE_OF,
          'each value in environments must be a string',
          'environments must contain no more than 4 elements'
        ]
      ],
      [
        'a key sent on PATCH',
        { key: 'new-key', enabled: 'x' },
        ['property key should not exist', 'enabled must be a boolean value']
      ]
    ])('PATCH reports %s', async (_, body, expected) => {
      await expect(
        errorsOf(await patchFlag(ABSENT_ID, body, '1'))
      ).resolves.toEqual(expected);
    });

    it('POST reports the key and the rule set together', async () => {
      await expect(
        errorsOf(await createFlag({ key: 'A', rules: 'nope' }))
      ).resolves.toEqual([
        'key must match /^[a-z0-9][a-z0-9-]*[a-z0-9]$/ regular expression',
        'key must be longer than or equal to 2 characters',
        ...NOT_ARRAY
      ]);
    });

    it('POST rejects an unknown property', async () => {
      await expect(
        errorsOf(await createFlag({ key: 'ok-key', foo: 1, enabled: 'x' }))
      ).resolves.toEqual([
        'property foo should not exist',
        'enabled must be a boolean value'
      ]);
    });

    it('preview reports the context fields, then the draft fields', async () => {
      await expect(
        errorsOf(
          await previewAbsent({
            foo: 1,
            userId: 'bad',
            rules: 'nope',
            enabled: 'x',
            environments: ['moon']
          })
        )
      ).resolves.toEqual([
        'property foo should not exist',
        'userId must be a UUID',
        ...NOT_ARRAY,
        'enabled must be a boolean value',
        ENVIRONMENT_ONE_OF
      ]);
    });

    it('preview accepts a null rule set and reaches the lookup', async () => {
      const res = await previewAbsent({ rules: null });
      expect(res.status).toBe(404);
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

    it.each(['1abc', '1.5', '0', '2147483648'])(
      'rejects If-Match %j with 400 and keeps the flag unchanged',
      async (ifMatch) => {
        const created = await createFlag({ key: 'order-if-match-junk' });
        const flag = (await created.json()) as { id: string; version: number };
        const res = await patchFlag(flag.id, { enabled: true }, ifMatch);
        expect(res.status).toBe(400);
        const body = (await res.json()) as { message: string };
        expect(body.message).toBe('If-Match must be a positive integer');
        const stored = getState().featureFlags.get(flag.id);
        expect(stored?.enabled).toBe(false);
        expect(stored?.version).toBe(flag.version);
      }
    );

    it('rejects a non-array rule set on an absent flag with 400, not 404', async () => {
      const res = await saveRules(ABSENT_ID, 'nope');
      expect(res.status).toBe(400);
      const body = (await res.json()) as { errors: string[] };
      expect(body.errors).toContain('rules must be an array');
    });

    it('rejects a non-object rule payload on an absent flag with 400, not 404', async () => {
      const res = await saveRules(ABSENT_ID, [
        { effect: 'include', payload: 'nope' }
      ]);
      expect(res.status).toBe(400);
    });

    it('answers 404 for a payload the rule validator rejects on an absent flag', async () => {
      const res = await saveRules(ABSENT_ID, [
        { effect: 'include', payload: { type: 'user' } }
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
        { rules: [{ effect: 'include', payload: {} }] },
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
        rules: [{ effect: 'include', payload: { type: 'user' } }]
      });
      expect(res.status).toBe(409);
    });
  });

  describe('flag and rules save together', () => {
    const roleRule = (name: string) => ({
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

    // The server pins the same keys: feature-flag-rule-response.e2e-spec.ts.
    it('answers the rule without a rule-level type on create and read', async () => {
      const ruleKeys = [
        'createdAt',
        'effect',
        'flagId',
        'id',
        'payload',
        'updatedAt'
      ];
      const res = await createFlag({
        key: 'rule-shape',
        rules: [roleRule('a')]
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as {
        id: string;
        rules: Record<string, unknown>[];
      };
      expect(Object.keys(created.rules[0]).sort()).toEqual(ruleKeys);

      const token = await loginAsAdmin();
      const read = await fetch(
        `${baseUrl}/api/v1/admin/feature-flags/${created.id}`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      const body = (await read.json()) as { rules: Record<string, unknown>[] };
      expect(Object.keys(body.rules[0]).sort()).toEqual(ruleKeys);
    });

    it('creates no flag when a rule payload is rejected', async () => {
      const res = await createFlag({
        key: 'atomic-create-rejected',
        rules: [roleRule('a'), { effect: 'include', payload: {} }]
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
          rules: [roleRule('b'), { effect: 'include', payload: {} }]
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
