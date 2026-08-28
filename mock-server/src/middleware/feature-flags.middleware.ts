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
  FeatureFlagAttributeKeysResponse,
  FeatureFlagResponse,
  FeatureFlagRulePayload
} from '@app/shared/types';
import {
  ALLOWED_FEATURE_FLAG_SORT_COLUMNS,
  APP_ENVIRONMENTS,
  BILLING_CONFIGURED_ATTRIBUTE,
  BILLING_PROVIDER_FLAGS,
  ErrorKeys,
  FEATURE_FLAG_ATTRIBUTE_FIELDS,
  FEATURE_FLAG_ATTRIBUTE_OPS,
  FEATURE_FLAG_RULE_EFFECTS,
  FEATURE_FLAG_RULE_TYPES,
  OAUTH_PROVIDER_FLAGS,
  normalizeEnvironmentList,
  type FeatureFlagAttributeField,
  type FeatureFlagAttributeOp,
  type FeatureFlagRuleEffect,
  type FeatureFlagRuleType
} from '@app/shared/constants';
import {
  cursorPaginate,
  cursorQueryErrors,
  parseCursorQuery
} from '../helpers/pagination.helpers';
import { attributeValueError } from '@app/shared/utils/feature-flag-attribute-value';
import { adminGuard, authenticateRequest } from '../helpers/auth.helpers';
import {
  requireUuid,
  validationError
} from '../helpers/validation-error.helpers';
import {
  objectErrors,
  stringArrayErrors,
  stringErrors,
  unknownPropertyErrors,
  uuidErrors
} from '../utils/validation';
import { pushToAll } from '../sse-hub';
import { getState, logAudit, toFeatureFlagResponse } from '../state';
import type { MockFeatureFlag, MockFeatureFlagRule } from '../types';
import { ANON_ID_COOKIE } from './anon-id.middleware';

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

// Mirrors the @Transform on CreateFeatureFlagDto.key: class-transformer trims
// the value before the length and pattern validators see it.
function trimKey(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

// Mirrors the server DTO: normalize first (trim/lowercase/dedupe), then reject
// anything outside the deployable environment names.
function validateEnvironments(
  input: unknown
): { ok: true; environments: string[] } | { ok: false; message: string } {
  if (!Array.isArray(input)) {
    return { ok: false, message: 'environments must be a string array' };
  }
  const normalized = normalizeEnvironmentList(input);
  if (!isStringArray(normalized)) {
    return { ok: false, message: 'environments must be a string array' };
  }
  const allowed: readonly string[] = APP_ENVIRONMENTS;
  if (normalized.some((e) => !allowed.includes(e))) {
    return {
      ok: false,
      message: `each environment must be one of: ${APP_ENVIRONMENTS.join(', ')}`
    };
  }
  return { ok: true, environments: normalized };
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
  const key = trimKey(body.key);
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
  let environments: string[] = [];
  if (body.environments !== undefined) {
    const validated = validateEnvironments(body.environments);
    if (!validated.ok) return validated;
    environments = validated.environments;
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
      environments,
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
    const key = trimKey(body.key);
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
    patch.key = key;
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
    const validated = validateEnvironments(body.environments);
    if (!validated.ok) return validated;
    patch.environments = validated.environments;
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

// `source` says which server layer rejects the same input: 'dto' is a
// class-validator failure on ReplaceRulesDto/FeatureFlagRuleDto (envelope
// carries `errors`), 'service' is a BadRequestException thrown by the
// rule-payload validator (bare message).
type RuleFailure = { ok: false; message: string; source: 'dto' | 'service' };

const dtoFail = (message: string): RuleFailure => ({
  ok: false,
  message,
  source: 'dto'
});

const serviceFail = (message: string): RuleFailure => ({
  ok: false,
  message,
  source: 'service'
});

function validateRulePayload(
  type: FeatureFlagRuleType,
  payload: unknown
): { ok: true; payload: FeatureFlagRulePayload } | RuleFailure {
  if (payload === null || typeof payload !== 'object') {
    // @IsObject() on FeatureFlagRuleDto.payload rejects this before the
    // rule-payload validator ever runs.
    return dtoFail('rule payload must be an object');
  }
  const p = payload as Record<string, unknown>;
  if (p['type'] !== type) {
    return serviceFail(
      `payload.type "${String(p['type'])}" does not match rule.type "${type}"`
    );
  }
  switch (type) {
    case 'user': {
      const userIds = p['userIds'];
      if (!isStringArray(userIds)) {
        return serviceFail('user rule requires userIds: string[]');
      }
      return { ok: true, payload: { type: 'user', userIds } };
    }
    case 'role': {
      const roleNames = p['roleNames'];
      if (!isStringArray(roleNames)) {
        return serviceFail('role rule requires roleNames: string[]');
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
        return serviceFail(
          'percentage rule requires percent: number in [0, 100]'
        );
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
        !FEATURE_FLAG_ATTRIBUTE_FIELDS.includes(
          field as FeatureFlagAttributeField
        )
      ) {
        return serviceFail(
          `attribute rule requires field ∈ ${FEATURE_FLAG_ATTRIBUTE_FIELDS.join(', ')}`
        );
      }
      if (
        typeof op !== 'string' ||
        !FEATURE_FLAG_ATTRIBUTE_OPS.includes(op as FeatureFlagAttributeOp)
      ) {
        return serviceFail(
          `attribute rule requires op ∈ ${FEATURE_FLAG_ATTRIBUTE_OPS.join(', ')}`
        );
      }
      if (field === 'custom') {
        if (typeof customKey !== 'string' || customKey === '') {
          return serviceFail(
            'attribute rule with field=custom requires customKey: string'
          );
        }
        if (!KNOWN_CUSTOM_KEYS.has(customKey)) {
          return serviceFail(
            `customKey "${customKey}" is not registered (mock-server has no DI registry)`
          );
        }
      }
      const valueError = attributeValueError(
        op as FeatureFlagAttributeOp,
        value
      );
      if (valueError) {
        return serviceFail(valueError);
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
): { ok: true; rules: ValidatedRule[] } | RuleFailure {
  if (!Array.isArray(input)) {
    return dtoFail('rules must be an array');
  }
  if (input.length > 64) {
    return dtoFail('rules array can contain at most 64 entries');
  }
  const out: ValidatedRule[] = [];
  for (let i = 0; i < input.length; i++) {
    const r = input[i] as IncomingRule;
    if (
      !FEATURE_FLAG_RULE_EFFECTS.includes(r.effect as FeatureFlagRuleEffect)
    ) {
      return dtoFail(
        `rules[${i}].effect must be one of: ${FEATURE_FLAG_RULE_EFFECTS.join(', ')}`
      );
    }
    if (!FEATURE_FLAG_RULE_TYPES.includes(r.type as FeatureFlagRuleType)) {
      return dtoFail(
        `rules[${i}].type must be one of: ${FEATURE_FLAG_RULE_TYPES.join(', ')}`
      );
    }
    const validated = validateRulePayload(
      r.type as FeatureFlagRuleType,
      r.payload
    );
    if (!validated.ok) {
      return { ...validated, message: `rules[${i}]: ${validated.message}` };
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

// Mirrors the real server's coalescing: a burst of flag changes collapses
// into one delayed broadcast instead of one synchronized refetch per change.
const FLAGS_BROADCAST_COALESCE_MS = 500;
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

function broadcastFlagsUpdated(): void {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    pushToAll({ type: 'feature_flags_updated' });
  }, FLAGS_BROADCAST_COALESCE_MS);
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

adminRouter.get('/cursor', (req, res) => {
  const query = req.query as Record<string, unknown>;
  const errors = cursorQueryErrors(query, {
    sortColumns: ALLOWED_FEATURE_FLAG_SORT_COLUMNS
  });
  if (errors.length > 0) {
    res.status(400).json(validationError(errors));
    return;
  }
  const page = cursorPaginate(
    Array.from(getState().featureFlags.values()),
    parseCursorQuery(query)
  );
  res.json({ data: page.data.map(toFeatureFlagResponse), meta: page.meta });
});

// Mirrors GET /admin/feature-flags/attribute-keys. Declared above the /:id
// handler so the literal segment wins, as /cursor is.
adminRouter.get('/attribute-keys', (_req, res) => {
  const body: FeatureFlagAttributeKeysResponse = {
    customKeys: Array.from(KNOWN_CUSTOM_KEYS).sort()
  };
  res.json(body);
});

adminRouter.get('/', (_req, res) => {
  const flags: FeatureFlagResponse[] = [];
  for (const flag of getState().featureFlags.values()) {
    flags.push(toFeatureFlagResponse(flag));
  }
  flags.sort((a, b) => a.key.localeCompare(b.key));
  res.json(flags);
});

adminRouter.get('/:id', requireUuid('id'), (req, res) => {
  const flag = getState().featureFlags.get((req.params['id'] as string) ?? '');
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
    res.status(400).json(validationError(validation.message));
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

adminRouter.patch('/:id', requireUuid('id'), (req, res) => {
  // Order mirrors the server: the global ValidationPipe rejects the body
  // before the handler reads If-Match, and both precede the service lookup.
  const validation = validateUpdate(req.body as UpdateFlagBody);
  if (!validation.ok) {
    res.status(400).json(validationError(validation.message));
    return;
  }
  const ifMatch = parseIfMatch(req.header('if-match') ?? undefined);
  if (!ifMatch.ok) {
    sendError(res, ifMatch.status, ifMatch.message, ifMatch.errorKey);
    return;
  }
  const flag = getState().featureFlags.get((req.params['id'] as string) ?? '');
  if (!flag) {
    sendError(
      res,
      404,
      'Feature flag not found',
      ErrorKeys.FEATURE_FLAGS.NOT_FOUND
    );
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
  }
  // The server compares the version inside the UPDATE ... WHERE clause, so the
  // key conflict above wins when a request is both stale and duplicate-keyed.
  if (flag.version !== ifMatch.version) {
    sendError(
      res,
      409,
      'Feature flag was modified by another request — reload and retry',
      ErrorKeys.FEATURE_FLAGS.VERSION_CONFLICT
    );
    return;
  }
  if (validation.patch.key !== undefined) {
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

adminRouter.delete('/:id', requireUuid('id'), (req, res) => {
  const id = (req.params['id'] as string) ?? '';
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

adminRouter.put('/:id/rules', requireUuid('id'), (req, res) => {
  const body = req.body as ReplaceRulesBody;
  const validation = validateRules(body.rules);
  // The two failure sources sit on opposite sides of the lookup on the server:
  // the ValidationPipe rejects a 'dto' failure before replaceRules runs, while
  // the rule-payload validator runs after findOne has already thrown the 404.
  if (!validation.ok && validation.source === 'dto') {
    res.status(400).json(validationError(validation.message));
    return;
  }
  const flag = getState().featureFlags.get((req.params['id'] as string) ?? '');
  if (!flag) {
    sendError(
      res,
      404,
      'Feature flag not found',
      ErrorKeys.FEATURE_FLAGS.NOT_FOUND
    );
    return;
  }
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

const MAX_ATTRIBUTE_KEYS = 32;
const MAX_ATTRIBUTE_KEY_LENGTH = 64;

const PREVIEW_BODY_KEYS = [
  'userId',
  'roles',
  'attributes',
  'env',
  'anonId',
  'rules',
  'enabled',
  'environments'
];

/**
 * Mirrors the server's `sanitizeAttributes`: it takes the first 32 entries and
 * only then drops the keys that are empty or over-long, so a rejected key still
 * consumes one of the 32 slots. Counting the accepted keys instead would let
 * the mock evaluate an attribute the server never sees.
 */
function sanitizeAttributes(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>).slice(
    0,
    MAX_ATTRIBUTE_KEYS
  );
  for (const [key, entry] of entries) {
    if (key.length === 0 || key.length > MAX_ATTRIBUTE_KEY_LENGTH) continue;
    out[key] = entry;
  }
  return out;
}

/**
 * Mirrors the context half of `PreviewFlagContextDto` under the global
 * ValidationPipe. class-validator whitelists before it validates and reports
 * the properties in declaration order, so the unknown-property errors lead and
 * the context fields follow in the order the DTO declares them. Every field is
 * `@IsOptional()`, which skips an explicit `null` as well as an omitted key.
 *
 * `userId` takes the body UUID pattern, not the looser one `ParseUUIDPipe`
 * applies to the `:id` route param.
 */
function previewContextErrors(body: Record<string, unknown>): string[] {
  return [
    ...unknownPropertyErrors(body, PREVIEW_BODY_KEYS),
    ...uuidErrors('userId', body['userId'], 'nullable'),
    ...stringArrayErrors('roles', body['roles'], {
      maxItems: 32,
      maxItemLength: 64,
      optional: 'nullable'
    }),
    ...objectErrors('attributes', body['attributes'], 'nullable'),
    ...stringErrors('env', body['env'], { max: 32, optional: 'nullable' }),
    ...stringErrors('anonId', body['anonId'], {
      max: 128,
      optional: 'nullable'
    })
  ];
}

adminRouter.post('/:id/preview', requireUuid('id'), (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  // The server resolves the body through the ValidationPipe before the handler
  // runs, so every DTO-level rejection precedes the 404, and the pipe reports
  // all of them together. Only the rule-payload validator lives in the service,
  // below the lookup.
  const errors = previewContextErrors(body);
  const rulesValidation =
    body['rules'] === undefined ? null : validateRules(body['rules']);
  if (
    rulesValidation &&
    !rulesValidation.ok &&
    rulesValidation.source === 'dto'
  ) {
    errors.push(rulesValidation.message);
  }
  if (body['enabled'] !== undefined && typeof body['enabled'] !== 'boolean') {
    errors.push('enabled must be a boolean value');
  }
  let draftEnvironments: string[] | undefined;
  if (body['environments'] !== undefined) {
    const validated = validateEnvironments(body['environments']);
    if (validated.ok) {
      draftEnvironments = validated.environments;
    } else {
      errors.push(validated.message);
    }
  }
  if (errors.length > 0) {
    res.status(400).json(validationError(errors));
    return;
  }
  const flag = getState().featureFlags.get((req.params['id'] as string) ?? '');
  if (!flag) {
    sendError(
      res,
      404,
      'Feature flag not found',
      ErrorKeys.FEATURE_FLAGS.NOT_FOUND
    );
    return;
  }
  if (rulesValidation && !rulesValidation.ok) {
    sendError(res, 400, rulesValidation.message);
    return;
  }
  // Every field passed the checks above, so the reads below only pick the
  // default for an omitted or explicitly null value.
  const userId = typeof body['userId'] === 'string' ? body['userId'] : null;
  const roles = isStringArray(body['roles']) ? body['roles'] : [];
  const attributes = sanitizeAttributes(body['attributes']);
  const env =
    typeof body['env'] === 'string'
      ? body['env']
      : (process.env['ENVIRONMENT'] ?? 'production');
  const anonId = typeof body['anonId'] === 'string' ? body['anonId'] : null;
  const rules: EvaluatorRule[] = rulesValidation?.ok
    ? rulesValidation.rules.map((r) => ({
        effect: r.effect,
        payload: r.payload
      }))
    : getState()
        .featureFlagRules.filter((r) => r.flagId === flag.id)
        .map((r) => ({ effect: r.effect, payload: r.payload }));
  const result = previewFeatureFlag(
    {
      key: flag.key,
      enabled: (body['enabled'] as boolean | undefined) ?? flag.enabled,
      environments: draftEnvironments ?? flag.environments
    },
    rules,
    { userId, anonId, roles, attributes, env }
  );
  res.json(result);
});

adminRouter.post('/:id/toggle', requireUuid('id'), (req, res) => {
  const flag = getState().featureFlags.get((req.params['id'] as string) ?? '');
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
