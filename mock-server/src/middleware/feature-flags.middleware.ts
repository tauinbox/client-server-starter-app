import { randomUUID } from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  evaluateFeatureFlag,
  previewFeatureFlag,
  type EvaluatorRule,
  type FeatureFlagEvaluationContext
} from '@app/shared/utils/feature-flag-evaluator';
import type {
  FeatureFlagAttributeField,
  FeatureFlagAttributeOp,
  FeatureFlagResponse,
  FeatureFlagRuleEffect,
  FeatureFlagRulePayload,
  FeatureFlagRuleType
} from '@app/shared/types';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import {
  BILLING_CONFIGURED_ATTRIBUTE,
  BILLING_PROVIDER_FLAGS,
  OAUTH_PROVIDER_FLAGS
} from '@app/shared/constants';
import { adminGuard, authenticateRequest } from '../helpers/auth.helpers';
import { pushToAll } from '../sse-hub';
import { getState, logAudit, toFeatureFlagResponse } from '../state';
import type { MockFeatureFlag, MockFeatureFlagRule } from '../types';
import { ANON_ID_COOKIE } from './anon-id.middleware';

const RULE_TYPES: readonly FeatureFlagRuleType[] = [
  'user',
  'role',
  'percentage',
  'attribute'
];
const RULE_EFFECTS: readonly FeatureFlagRuleEffect[] = ['include', 'exclude'];
const ATTRIBUTE_FIELDS: readonly FeatureFlagAttributeField[] = [
  'email',
  'emailDomain',
  'createdAt',
  'custom'
];
const ATTRIBUTE_OPS: readonly FeatureFlagAttributeOp[] = [
  'eq',
  'in',
  'endsWith',
  'before',
  'after'
];

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

// Mirrors the server's attribute registry. The custom attributes are the
// per-OAuth-provider "configured" signals (registered by the server's
// OAuthProviderFlagAttributesRegistrar) plus the billing per-provider and
// combined "configured" signals (BillingConfiguredAttributesRegistrar). The
// mock environment treats every provider as configured (see
// CONFIGURED_ATTRIBUTES) so the OAuth buttons and billing UI show in dev / E2E.
const BILLING_CONFIGURED_KEYS: readonly string[] = [
  ...BILLING_PROVIDER_FLAGS.map((p) => p.configuredAttribute),
  BILLING_CONFIGURED_ATTRIBUTE
];

const KNOWN_CUSTOM_KEYS: ReadonlySet<string> = new Set([
  ...OAUTH_PROVIDER_FLAGS.map((p) => p.attributeKey),
  ...BILLING_CONFIGURED_KEYS
]);

const CONFIGURED_ATTRIBUTES: Record<string, boolean> = Object.fromEntries([
  ...OAUTH_PROVIDER_FLAGS.map((p) => [p.attributeKey, true]),
  ...BILLING_CONFIGURED_KEYS.map((k) => [k, true])
]);

function nowIso(): string {
  return new Date().toISOString();
}

function sendError(
  res: Response,
  status: number,
  message: string,
  errorKey?: string
): void {
  res.status(status).json({ message, statusCode: status, errorKey });
}

interface CreateFlagBody {
  key?: unknown;
  description?: unknown;
  enabled?: unknown;
  environments?: unknown;
  public?: unknown;
}

type UpdateFlagBody = CreateFlagBody;

interface ReplaceRulesBody {
  rules?: unknown;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

type CreateData = {
  key: string;
  description: string | null;
  enabled: boolean;
  environments: string[];
  isPublic: boolean;
};

function validateCreate(
  body: CreateFlagBody
): { ok: true; data: CreateData } | { ok: false; message: string } {
  const key = body.key;
  if (
    typeof key !== 'string' ||
    key.length < 2 ||
    key.length > 100 ||
    !KEY_PATTERN.test(key)
  ) {
    return {
      ok: false,
      message: 'key must match ^[a-z0-9][a-z0-9-]*[a-z0-9]$ (2-100 chars)'
    };
  }
  if (body.description !== undefined && body.description !== null) {
    if (typeof body.description !== 'string' || body.description.length > 500) {
      return {
        ok: false,
        message: 'description must be a string (max 500 chars)'
      };
    }
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    return { ok: false, message: 'enabled must be a boolean' };
  }
  if (body.environments !== undefined) {
    if (!isStringArray(body.environments) || body.environments.length > 16) {
      return {
        ok: false,
        message: 'environments must be a string array (max 16 entries)'
      };
    }
    if (body.environments.some((e) => e.length > 32)) {
      return {
        ok: false,
        message: 'each environment entry must be ≤ 32 chars'
      };
    }
  }
  if (body.public !== undefined && typeof body.public !== 'boolean') {
    return { ok: false, message: 'public must be a boolean' };
  }
  return {
    ok: true,
    data: {
      key,
      description: (body.description as string | null | undefined) ?? null,
      enabled: (body.enabled as boolean | undefined) ?? false,
      environments: (body.environments as string[] | undefined) ?? [],
      isPublic: (body.public as boolean | undefined) ?? false
    }
  };
}

type UpdatePatch = Partial<CreateData>;

function validateUpdate(
  body: UpdateFlagBody
): { ok: true; patch: UpdatePatch } | { ok: false; message: string } {
  const patch: UpdatePatch = {};
  if (body.key !== undefined) {
    if (
      typeof body.key !== 'string' ||
      body.key.length < 2 ||
      body.key.length > 100 ||
      !KEY_PATTERN.test(body.key)
    ) {
      return {
        ok: false,
        message: 'key must match ^[a-z0-9][a-z0-9-]*[a-z0-9]$ (2-100 chars)'
      };
    }
    patch.key = body.key;
  }
  if (body.description !== undefined) {
    if (
      body.description !== null &&
      (typeof body.description !== 'string' || body.description.length > 500)
    ) {
      return {
        ok: false,
        message: 'description must be a string (max 500 chars) or null'
      };
    }
    patch.description = body.description as string | null;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') {
      return { ok: false, message: 'enabled must be a boolean' };
    }
    patch.enabled = body.enabled;
  }
  if (body.environments !== undefined) {
    if (!isStringArray(body.environments) || body.environments.length > 16) {
      return {
        ok: false,
        message: 'environments must be a string array (max 16 entries)'
      };
    }
    if (body.environments.some((e) => e.length > 32)) {
      return {
        ok: false,
        message: 'each environment entry must be ≤ 32 chars'
      };
    }
    patch.environments = body.environments;
  }
  if (body.public !== undefined) {
    if (typeof body.public !== 'boolean') {
      return { ok: false, message: 'public must be a boolean' };
    }
    patch.isPublic = body.public;
  }
  return { ok: true, patch };
}

interface IncomingRule {
  type?: unknown;
  effect?: unknown;
  payload?: unknown;
}

function validateRulePayload(
  type: FeatureFlagRuleType,
  payload: unknown
):
  | { ok: true; payload: FeatureFlagRulePayload }
  | { ok: false; message: string } {
  if (payload === null || typeof payload !== 'object') {
    return { ok: false, message: 'rule payload must be an object' };
  }
  const p = payload as Record<string, unknown>;
  if (p['type'] !== type) {
    return {
      ok: false,
      message: `payload.type "${String(p['type'])}" does not match rule.type "${type}"`
    };
  }
  switch (type) {
    case 'user': {
      const userIds = p['userIds'];
      if (!isStringArray(userIds)) {
        return { ok: false, message: 'user rule requires userIds: string[]' };
      }
      return { ok: true, payload: { type: 'user', userIds } };
    }
    case 'role': {
      const roleNames = p['roleNames'];
      if (!isStringArray(roleNames)) {
        return { ok: false, message: 'role rule requires roleNames: string[]' };
      }
      return { ok: true, payload: { type: 'role', roleNames } };
    }
    case 'percentage': {
      const percent = p['percent'];
      if (
        typeof percent !== 'number' ||
        !Number.isFinite(percent) ||
        percent < 0 ||
        percent > 100
      ) {
        return {
          ok: false,
          message: 'percentage rule requires percent: number in [0, 100]'
        };
      }
      return { ok: true, payload: { type: 'percentage', percent } };
    }
    case 'attribute': {
      const field = p['field'];
      const op = p['op'];
      const value = p['value'];
      const customKey = p['customKey'];
      if (
        typeof field !== 'string' ||
        !ATTRIBUTE_FIELDS.includes(field as FeatureFlagAttributeField)
      ) {
        return {
          ok: false,
          message: `attribute rule requires field ∈ ${ATTRIBUTE_FIELDS.join(', ')}`
        };
      }
      if (
        typeof op !== 'string' ||
        !ATTRIBUTE_OPS.includes(op as FeatureFlagAttributeOp)
      ) {
        return {
          ok: false,
          message: `attribute rule requires op ∈ ${ATTRIBUTE_OPS.join(', ')}`
        };
      }
      if (field === 'custom') {
        if (typeof customKey !== 'string' || customKey === '') {
          return {
            ok: false,
            message:
              'attribute rule with field=custom requires customKey: string'
          };
        }
        if (!KNOWN_CUSTOM_KEYS.has(customKey)) {
          return {
            ok: false,
            message: `customKey "${customKey}" is not registered (mock-server has no DI registry)`
          };
        }
      }
      return {
        ok: true,
        payload: {
          type: 'attribute',
          field: field as FeatureFlagAttributeField,
          op: op as FeatureFlagAttributeOp,
          value,
          ...(typeof customKey === 'string' ? { customKey } : {})
        }
      };
    }
  }
}

type ValidatedRule = {
  type: FeatureFlagRuleType;
  effect: FeatureFlagRuleEffect;
  payload: FeatureFlagRulePayload;
};

function validateRules(
  input: unknown
): { ok: true; rules: ValidatedRule[] } | { ok: false; message: string } {
  if (!Array.isArray(input)) {
    return { ok: false, message: 'rules must be an array' };
  }
  if (input.length > 64) {
    return { ok: false, message: 'rules array can contain at most 64 entries' };
  }
  const out: ValidatedRule[] = [];
  for (let i = 0; i < input.length; i++) {
    const r = input[i] as IncomingRule;
    if (!RULE_EFFECTS.includes(r.effect as FeatureFlagRuleEffect)) {
      return {
        ok: false,
        message: `rules[${i}].effect must be one of: ${RULE_EFFECTS.join(', ')}`
      };
    }
    if (!RULE_TYPES.includes(r.type as FeatureFlagRuleType)) {
      return {
        ok: false,
        message: `rules[${i}].type must be one of: ${RULE_TYPES.join(', ')}`
      };
    }
    const validated = validateRulePayload(
      r.type as FeatureFlagRuleType,
      r.payload
    );
    if (!validated.ok) {
      return { ok: false, message: `rules[${i}]: ${validated.message}` };
    }
    out.push({
      type: r.type as FeatureFlagRuleType,
      effect: r.effect as FeatureFlagRuleEffect,
      payload: validated.payload
    });
  }
  return { ok: true, rules: out };
}

function parseIfMatch(
  header: string | undefined
):
  | { ok: true; version: number }
  | { ok: false; status: number; message: string; errorKey?: string } {
  if (header === undefined || header === '') {
    return {
      ok: false,
      status: 428,
      message: 'If-Match header is required for optimistic locking',
      errorKey: ErrorKeys.FEATURE_FLAGS.IF_MATCH_REQUIRED
    };
  }
  const stripped = header.replace(/^"|"$/g, '').trim();
  const parsed = Number.parseInt(stripped, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return {
      ok: false,
      status: 400,
      message: 'If-Match must be a positive integer'
    };
  }
  return { ok: true, version: parsed };
}

function broadcastFlagsUpdated(): void {
  pushToAll({ type: 'feature_flags_updated' });
}

function findFlagByKey(key: string): MockFeatureFlag | undefined {
  for (const f of getState().featureFlags.values()) {
    if (f.key === key) return f;
  }
  return undefined;
}

function actorIdFromReq(req: Request): string | null {
  const result = authenticateRequest(req);
  return result?.user.id ?? null;
}

function buildEvaluationContext(req: Request): FeatureFlagEvaluationContext {
  const result = authenticateRequest(req);
  const env = process.env['ENVIRONMENT'] ?? 'production';
  const cookies = (req.cookies ?? {}) as Record<string, unknown>;
  const cookieValue = cookies[ANON_ID_COOKIE];
  const anonId = typeof cookieValue === 'string' ? cookieValue : null;
  if (!result) {
    return {
      userId: null,
      anonId,
      roles: [],
      attributes: { ...CONFIGURED_ATTRIBUTES },
      env
    };
  }
  const { user } = result;
  const at = user.email.lastIndexOf('@');
  const emailDomain = at >= 0 ? user.email.slice(at + 1) : undefined;
  const attributes: Record<string, unknown> = {
    ...CONFIGURED_ATTRIBUTES,
    email: user.email
  };
  if (emailDomain) attributes['emailDomain'] = emailDomain;
  if (user.createdAt) attributes['createdAt'] = user.createdAt;
  return {
    userId: user.id,
    anonId,
    roles: user.roles,
    attributes,
    env
  };
}

function evaluateAll(
  ctx: FeatureFlagEvaluationContext,
  publicOnly: boolean
): { flags: Record<string, boolean>; evaluatedAt: string } {
  const result: Record<string, boolean> = {};
  const state = getState();
  for (const flag of state.featureFlags.values()) {
    if (publicOnly && !flag.public) continue;
    const rules: EvaluatorRule[] = state.featureFlagRules
      .filter((r) => r.flagId === flag.id)
      .map((r) => ({
        effect: r.effect,
        payload: r.payload
      }));
    const value = evaluateFeatureFlag(
      { key: flag.key, enabled: flag.enabled, environments: flag.environments },
      rules,
      ctx
    );
    // Mirror server: omit disabled non-public flags from the authenticated
    // response so internal/unfinished feature keys are not enumerable.
    if (!publicOnly && !value && !flag.public) continue;
    result[flag.key] = value;
  }
  return { flags: result, evaluatedAt: nowIso() };
}

// ── Public router ──────────────────────────────────────────────────────────
const publicRouter = Router();

publicRouter.get('/', (req, res) => {
  const authenticated = authenticateRequest(req);
  const ctx = buildEvaluationContext(req);
  const response = evaluateAll(ctx, /* publicOnly */ authenticated === null);
  res.json(response);
});

// ── Admin router ───────────────────────────────────────────────────────────
const adminRouter = Router();

adminRouter.use(adminGuard);

adminRouter.get('/', (_req, res) => {
  const flags: FeatureFlagResponse[] = [];
  for (const flag of getState().featureFlags.values()) {
    flags.push(toFeatureFlagResponse(flag));
  }
  flags.sort((a, b) => a.key.localeCompare(b.key));
  res.json(flags);
});

adminRouter.get('/:id', (req, res) => {
  const flag = getState().featureFlags.get(req.params['id'] ?? '');
  if (!flag) {
    sendError(
      res,
      404,
      'Feature flag not found',
      ErrorKeys.FEATURE_FLAGS.NOT_FOUND
    );
    return;
  }
  res.json(toFeatureFlagResponse(flag));
});

adminRouter.post('/', (req, res) => {
  const validation = validateCreate(req.body as CreateFlagBody);
  if (!validation.ok) {
    sendError(res, 400, validation.message);
    return;
  }
  if (findFlagByKey(validation.data.key)) {
    sendError(
      res,
      409,
      'Feature flag with this key already exists',
      ErrorKeys.FEATURE_FLAGS.KEY_EXISTS
    );
    return;
  }
  const now = nowIso();
  const flag: MockFeatureFlag = {
    id: randomUUID(),
    key: validation.data.key,
    description: validation.data.description,
    enabled: validation.data.enabled,
    environments: validation.data.environments,
    public: validation.data.isPublic,
    version: 1,
    updatedByUserId: actorIdFromReq(req),
    createdAt: now,
    updatedAt: now
  };
  getState().featureFlags.set(flag.id, flag);
  logAudit('FEATURE_FLAG_CREATE', {
    actorId: actorIdFromReq(req),
    targetId: flag.id,
    targetType: 'FeatureFlag',
    details: { key: flag.key, flagId: flag.id }
  });
  broadcastFlagsUpdated();
  res.status(201).json(toFeatureFlagResponse(flag));
});

adminRouter.patch('/:id', (req, res) => {
  const flag = getState().featureFlags.get(req.params['id'] ?? '');
  if (!flag) {
    sendError(
      res,
      404,
      'Feature flag not found',
      ErrorKeys.FEATURE_FLAGS.NOT_FOUND
    );
    return;
  }
  const ifMatch = parseIfMatch(req.header('if-match') ?? undefined);
  if (!ifMatch.ok) {
    sendError(res, ifMatch.status, ifMatch.message, ifMatch.errorKey);
    return;
  }
  if (flag.version !== ifMatch.version) {
    sendError(
      res,
      409,
      'Feature flag was modified by another request — reload and retry',
      ErrorKeys.FEATURE_FLAGS.VERSION_CONFLICT
    );
    return;
  }
  const validation = validateUpdate(req.body as UpdateFlagBody);
  if (!validation.ok) {
    sendError(res, 400, validation.message);
    return;
  }
  if (validation.patch.key !== undefined) {
    const conflict = findFlagByKey(validation.patch.key);
    if (conflict && conflict.id !== flag.id) {
      sendError(
        res,
        409,
        'Feature flag with this key already exists',
        ErrorKeys.FEATURE_FLAGS.KEY_EXISTS
      );
      return;
    }
    flag.key = validation.patch.key;
  }
  if (validation.patch.description !== undefined) {
    flag.description = validation.patch.description;
  }
  if (validation.patch.enabled !== undefined)
    flag.enabled = validation.patch.enabled;
  if (validation.patch.environments !== undefined) {
    flag.environments = validation.patch.environments;
  }
  if (validation.patch.isPublic !== undefined)
    flag.public = validation.patch.isPublic;
  flag.version += 1;
  flag.updatedAt = nowIso();
  flag.updatedByUserId = actorIdFromReq(req);
  logAudit('FEATURE_FLAG_UPDATE', {
    actorId: actorIdFromReq(req),
    targetId: flag.id,
    targetType: 'FeatureFlag',
    details: { changedFields: Object.keys(req.body as object) }
  });
  broadcastFlagsUpdated();
  res.json(toFeatureFlagResponse(flag));
});

adminRouter.delete('/:id', (req, res) => {
  const id = req.params['id'] ?? '';
  const flag = getState().featureFlags.get(id);
  if (!flag) {
    sendError(
      res,
      404,
      'Feature flag not found',
      ErrorKeys.FEATURE_FLAGS.NOT_FOUND
    );
    return;
  }
  const state = getState();
  state.featureFlags.delete(id);
  state.featureFlagRules = state.featureFlagRules.filter(
    (r) => r.flagId !== id
  );
  logAudit('FEATURE_FLAG_DELETE', {
    actorId: actorIdFromReq(req),
    targetId: flag.id,
    targetType: 'FeatureFlag',
    details: { key: flag.key }
  });
  broadcastFlagsUpdated();
  res.status(204).end();
});

adminRouter.put('/:id/rules', (req, res) => {
  const flag = getState().featureFlags.get(req.params['id'] ?? '');
  if (!flag) {
    sendError(
      res,
      404,
      'Feature flag not found',
      ErrorKeys.FEATURE_FLAGS.NOT_FOUND
    );
    return;
  }
  const body = req.body as ReplaceRulesBody;
  const validation = validateRules(body.rules);
  if (!validation.ok) {
    sendError(res, 400, validation.message);
    return;
  }
  const state = getState();
  state.featureFlagRules = state.featureFlagRules.filter(
    (r) => r.flagId !== flag.id
  );
  const now = Date.now();
  const updatedAt = new Date(now).toISOString();
  for (let i = 0; i < validation.rules.length; i++) {
    const r = validation.rules[i];
    // Stagger createdAt per index so admin GET returns rules in insertion order
    // (mirrors server-side clock_timestamp() default).
    const createdAt = new Date(now + i).toISOString();
    const rule: MockFeatureFlagRule = {
      id: randomUUID(),
      flagId: flag.id,
      type: r.type,
      effect: r.effect,
      payload: r.payload,
      createdAt,
      updatedAt
    };
    state.featureFlagRules.push(rule);
  }
  flag.version += 1;
  flag.updatedAt = updatedAt;
  flag.updatedByUserId = actorIdFromReq(req);
  logAudit('FEATURE_FLAG_RULES_REPLACE', {
    actorId: actorIdFromReq(req),
    targetId: flag.id,
    targetType: 'FeatureFlag',
    details: { ruleCount: validation.rules.length }
  });
  broadcastFlagsUpdated();
  res.json(toFeatureFlagResponse(flag));
});

adminRouter.post('/:id/preview', (req, res) => {
  const flag = getState().featureFlags.get(req.params['id'] ?? '');
  if (!flag) {
    sendError(
      res,
      404,
      'Feature flag not found',
      ErrorKeys.FEATURE_FLAGS.NOT_FOUND
    );
    return;
  }
  const body = (req.body ?? {}) as {
    userId?: unknown;
    roles?: unknown;
    attributes?: unknown;
    env?: unknown;
    anonId?: unknown;
  };
  const userId =
    typeof body.userId === 'string' && body.userId.length <= 128
      ? body.userId
      : null;
  const roles = isStringArray(body.roles)
    ? body.roles.slice(0, 32).filter((r) => r.length <= 64)
    : [];
  const attributes: Record<string, unknown> = {};
  if (body.attributes !== null && typeof body.attributes === 'object') {
    let count = 0;
    for (const [key, value] of Object.entries(
      body.attributes as Record<string, unknown>
    )) {
      if (count >= 32) break;
      if (typeof key !== 'string' || key.length === 0 || key.length > 64) {
        continue;
      }
      attributes[key] = value;
      count++;
    }
  }
  const env =
    typeof body.env === 'string' && body.env.length <= 32
      ? body.env
      : (process.env['ENVIRONMENT'] ?? 'production');
  const anonId =
    typeof body.anonId === 'string' && body.anonId.length <= 128
      ? body.anonId
      : null;
  const rules: EvaluatorRule[] = getState()
    .featureFlagRules.filter((r) => r.flagId === flag.id)
    .map((r) => ({ effect: r.effect, payload: r.payload }));
  const result = previewFeatureFlag(
    { key: flag.key, enabled: flag.enabled, environments: flag.environments },
    rules,
    { userId, anonId, roles, attributes, env }
  );
  res.json(result);
});

adminRouter.post('/:id/toggle', (req, res) => {
  const flag = getState().featureFlags.get(req.params['id'] ?? '');
  if (!flag) {
    sendError(
      res,
      404,
      'Feature flag not found',
      ErrorKeys.FEATURE_FLAGS.NOT_FOUND
    );
    return;
  }
  flag.enabled = !flag.enabled;
  flag.version += 1;
  flag.updatedAt = nowIso();
  flag.updatedByUserId = actorIdFromReq(req);
  logAudit('FEATURE_FLAG_TOGGLE', {
    actorId: actorIdFromReq(req),
    targetId: flag.id,
    targetType: 'FeatureFlag',
    details: { enabled: flag.enabled }
  });
  broadcastFlagsUpdated();
  res.json(toFeatureFlagResponse(flag));
});

export {
  publicRouter as featureFlagsRouter,
  adminRouter as featureFlagsAdminRouter
};
