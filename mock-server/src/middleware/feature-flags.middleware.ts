import { randomUUID } from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  anonymousEvaluationNeedsAnonId,
  evaluateFeatureFlag,
  previewFeatureFlag,
  signedInEvaluationNeedsAnonId,
  type EvaluatorRule,
  type FeatureFlagEvaluationContext
} from '@app/shared/utils/feature-flag-evaluator';
import type {
  FeatureFlagAttributeKeysResponse,
  FeatureFlagRulePayload
} from '@app/shared/types';
import {
  APP_ENVIRONMENTS,
  BILLING_CONFIGURED_ATTRIBUTE,
  BILLING_PROVIDER_FLAGS,
  ErrorKeys,
  FEATURE_FLAG_KEY_MAX_LENGTH,
  FEATURE_FLAG_LIST_QUERY,
  FEATURE_FLAG_KEY_MIN_LENGTH,
  FEATURE_FLAG_KEY_PATTERN,
  FEATURE_FLAG_ROLE_NAMES_MAX_ITEMS,
  FEATURE_FLAG_RULE_EFFECTS,
  FEATURE_FLAG_RULE_TYPES,
  OAUTH_PROVIDER_FLAGS,
  ROLE_NAME_MAX_LENGTH,
  normalizeEnvironmentList,
  type FeatureFlagRuleEffect,
  type FeatureFlagRuleType
} from '@app/shared/constants';
import { listPage, listQueryErrors } from '../helpers/list-query.helpers';
import { parseFeatureFlagRulePayload } from '@app/shared/utils/feature-flag-rule-payload';
import { changedFields } from '@app/shared/utils/changed-fields';
import {
  assertInstancePermission,
  authenticateRequest,
  permissionGuard
} from '../helpers/auth.helpers';
import { filterByAbility } from '../helpers/ability-filter.helpers';
import {
  requireUuid,
  validationError
} from '../helpers/validation-error.helpers';
import {
  booleanErrors,
  objectErrors,
  oneOfErrors,
  stringArrayErrors,
  stringErrors,
  unknownPropertyErrors,
  uuidErrors,
  type OptionalMode
} from '../utils/validation';
import { pushToAll } from '../sse-hub';
import { getState, logAudit, toFeatureFlagResponse } from '../state';
import type {
  AuthenticatedRequest,
  MockFeatureFlag,
  MockFeatureFlagRule,
  MockUser
} from '../types';
import { readAnonId, writeAnonId } from '../helpers/anon-id.helpers';

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
  rules?: unknown;
}

type UpdateFlagBody = Omit<CreateFlagBody, 'key'>;

const UPDATE_BODY_KEYS = [
  'description',
  'enabled',
  'environments',
  'public',
  'rules'
] as const;

const CREATE_BODY_KEYS = ['key', ...UPDATE_BODY_KEYS] as const;

// Mirrors CreateFeatureFlagDto.key: the trim runs first, then the decorators
// report bottom-up, so `@Matches` comes ahead of the length and type rules.
function keyErrors(value: unknown): string[] {
  const key = typeof value === 'string' ? value.trim() : value;
  const errors: string[] = [];
  if (typeof key !== 'string' || !FEATURE_FLAG_KEY_PATTERN.test(key)) {
    errors.push(
      `key must match ${String(FEATURE_FLAG_KEY_PATTERN)} regular expression`
    );
  }
  return [
    ...errors,
    ...stringErrors('key', key, {
      min: FEATURE_FLAG_KEY_MIN_LENGTH,
      max: FEATURE_FLAG_KEY_MAX_LENGTH
    })
  ];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

const ENVIRONMENTS_ONE_OF = `each value in environments must be one of the following values: ${APP_ENVIRONMENTS.join(', ')}`;

// Mirrors `@Transform(normalizeEnvironmentList) @ValidateIf(propertyIsDefined)
// @IsArray() @ArrayMaxSize @IsString({ each: true }) @IsIn({ each: true })`,
// reported bottom-up. An `each` rule validates a non-array as its one element.
function environmentErrors(value: unknown): string[] {
  if (value === undefined) return [];
  const normalized = Array.isArray(value)
    ? normalizeEnvironmentList(value)
    : value;
  const isArray = Array.isArray(normalized);
  const items: unknown[] = isArray ? normalized : [normalized];
  const allowed: readonly unknown[] = APP_ENVIRONMENTS;
  const errors: string[] = [];
  if (items.some((e) => !allowed.includes(e))) errors.push(ENVIRONMENTS_ONE_OF);
  if (items.some((e) => typeof e !== 'string')) {
    errors.push('each value in environments must be a string');
  }
  if (!isArray || items.length > APP_ENVIRONMENTS.length) {
    errors.push(
      `environments must contain no more than ${APP_ENVIRONMENTS.length} elements`
    );
  }
  if (!isArray) errors.push('environments must be an array');
  return errors;
}

// Call it only on a value that environmentErrors accepted.
function normalizedEnvironments(value: unknown): string[] {
  return normalizeEnvironmentList(value as unknown[]).filter(isString);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

const MAX_RULES = 64;
const RULE_KEYS = ['effect', 'type', 'payload'] as const;
const NESTED_RULES_MESSAGE =
  'each value in nested property rules must be either object or array';

// The ValidationPipe flattens a nested error from its leaves: a leaf message
// gets the path of its parent, and a parent with child errors loses its own
// messages. So a primitive entry reports no index, and a too-long array with a
// bad entry reports only the entry.
function ruleObjectErrors(path: string, rule: object): string[] {
  const r = rule as Record<string, unknown>;
  return [
    ...unknownPropertyErrors(r, RULE_KEYS),
    ...oneOfErrors('effect', r['effect'], FEATURE_FLAG_RULE_EFFECTS),
    ...oneOfErrors('type', r['type'], FEATURE_FLAG_RULE_TYPES),
    ...objectErrors('payload', r['payload'])
  ].map((message) => `${path}.${message}`);
}

function ruleEntryErrors(path: string, entries: unknown[]): string[] {
  return entries.flatMap((entry, i) => {
    if (Array.isArray(entry)) return ruleEntryErrors(`${path}.${i}`, entry);
    if (typeof entry === 'object' && entry !== null) {
      return ruleObjectErrors(`${path}.${i}`, entry);
    }
    return [`${path}.${NESTED_RULES_MESSAGE}`];
  });
}

// Mirrors `@IsArray() @ArrayMaxSize(64) @ValidateNested({ each: true })
// @Type(() => FeatureFlagRuleDto)`. A plain object is validated as one rule.
function rulesErrors(value: unknown, optional: OptionalMode): string[] {
  if (value === undefined || (optional === 'nullable' && value === null)) {
    return [];
  }
  const isObject = typeof value === 'object' && value !== null;
  const children = Array.isArray(value)
    ? ruleEntryErrors('rules', value)
    : isObject
      ? ruleObjectErrors('rules', value)
      : [];
  if (children.length > 0) return children;
  const errors: string[] = [];
  if (!Array.isArray(value) || value.length > MAX_RULES) {
    errors.push(`rules must contain no more than ${MAX_RULES} elements`);
  }
  if (!Array.isArray(value)) errors.push('rules must be an array');
  if (!isObject) errors.push(NESTED_RULES_MESSAGE);
  return errors;
}

// The fields that CreateFeatureFlagDto and UpdateFeatureFlagDto share, in
// declaration order.
function flagFieldErrors(body: UpdateFlagBody): string[] {
  return [
    ...stringErrors('description', body.description, {
      max: 500,
      optional: 'nullable'
    }),
    ...booleanErrors('enabled', body.enabled, 'definedOnly'),
    ...environmentErrors(body.environments),
    ...booleanErrors('public', body.public, 'definedOnly'),
    ...rulesErrors(body.rules, 'definedOnly')
  ];
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
): { ok: true; data: CreateData } | { ok: false; message: string[] } {
  const errors = [
    ...unknownPropertyErrors(body, CREATE_BODY_KEYS),
    ...keyErrors(body.key),
    ...flagFieldErrors(body)
  ];
  if (errors.length > 0) return { ok: false, message: errors };
  return {
    ok: true,
    data: {
      key: (body.key as string).trim(),
      description: (body.description as string | null | undefined) ?? null,
      enabled: (body.enabled as boolean | undefined) ?? false,
      environments:
        body.environments === undefined
          ? []
          : normalizedEnvironments(body.environments),
      isPublic: (body.public as boolean | undefined) ?? false
    }
  };
}

type UpdatePatch = Partial<Omit<CreateData, 'key'>>;

function validateUpdate(
  body: UpdateFlagBody
): { ok: true; patch: UpdatePatch } | { ok: false; message: string[] } {
  const errors = [
    ...unknownPropertyErrors(body, UPDATE_BODY_KEYS),
    ...flagFieldErrors(body)
  ];
  if (errors.length > 0) return { ok: false, message: errors };
  const patch: UpdatePatch = {};
  if (body.description !== undefined) {
    patch.description = body.description as string | null;
  }
  if (body.enabled !== undefined) patch.enabled = body.enabled as boolean;
  if (body.environments !== undefined) {
    patch.environments = normalizedEnvironments(body.environments);
  }
  if (body.public !== undefined) patch.isPublic = body.public as boolean;
  return { ok: true, patch };
}

interface IncomingRule {
  type?: unknown;
  effect?: unknown;
  payload?: unknown;
}

type ValidatedRule = {
  type: FeatureFlagRuleType;
  effect: FeatureFlagRuleEffect;
  payload: FeatureFlagRulePayload;
};

// The server runs the rule-payload validator in the service, after the
// lookups, and answers the first rejected rule with a bare 400. Call it only on
// a value that rulesErrors accepted.
function parseRules(
  value: unknown
): { ok: true; rules: ValidatedRule[] } | { ok: false; message: string } {
  const out: ValidatedRule[] = [];
  for (const entry of value as IncomingRule[]) {
    const type = entry.type as FeatureFlagRuleType;
    const parsed = parseFeatureFlagRulePayload(
      type,
      entry.payload,
      KNOWN_CUSTOM_KEYS
    );
    if (!parsed.ok) return parsed;
    out.push({
      type,
      effect: entry.effect as FeatureFlagRuleEffect,
      payload: parsed.payload
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

// Mirrors FeatureFlagService.rewriteRoleName and RoleRulesListener: replace a
// role name in every role rule, or remove it when newName is null. The order is
// kept, a duplicate is dropped, and each changed flag gets a new version.
export function rewriteRoleNameInRules(
  oldName: string,
  newName: string | null
): void {
  const state = getState();
  const updatedAt = nowIso();
  const changedFlagIds = new Set<string>();
  for (const rule of state.featureFlagRules) {
    const { payload } = rule;
    if (payload.type !== 'role' || !payload.roleNames.includes(oldName)) {
      continue;
    }
    const mapped = payload.roleNames
      .map((name) => (name === oldName ? newName : name))
      .filter((name): name is string => name !== null);
    rule.payload = { type: 'role', roleNames: [...new Set(mapped)] };
    rule.updatedAt = updatedAt;
    changedFlagIds.add(rule.flagId);
  }
  for (const id of changedFlagIds) {
    const flag = state.featureFlags.get(id);
    if (!flag) continue;
    flag.version += 1;
    flag.updatedAt = updatedAt;
  }
  if (changedFlagIds.size > 0) broadcastFlagsUpdated();
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

function evaluationEnv(): string {
  return process.env['ENVIRONMENT'] ?? 'production';
}

function anonymousContext(anonId: string | null): FeatureFlagEvaluationContext {
  return {
    userId: null,
    anonId,
    roles: [],
    attributes: { ...CONFIGURED_ATTRIBUTES },
    env: evaluationEnv()
  };
}

function userContext(
  user: MockUser,
  anonId: string | null
): FeatureFlagEvaluationContext {
  const at = user.email.lastIndexOf('@');
  const emailDomain = at >= 0 ? user.email.slice(at + 1) : undefined;
  const attributes: Record<string, unknown> = {
    ...CONFIGURED_ATTRIBUTES,
    email: user.email
  };
  if (emailDomain) attributes['emailDomain'] = emailDomain;
  // A Date, as the server resolves it: `eq` and `in` must not match it.
  if (user.createdAt) attributes['createdAt'] = new Date(user.createdAt);
  // As the server: only a rule bucketed by device reads `anonId` here.
  return {
    userId: user.id,
    anonId,
    roles: user.roles,
    attributes,
    env: evaluationEnv()
  };
}

// Mirrors FeatureFlagResolverService.evaluateAnonymous / evaluateSignedIn: an
// anonymous caller gets the rollout id only when a public percentage rule
// reads it, a signed-in caller only when a live rule buckets by device.
function resolveAnonId(
  req: Request,
  res: Response,
  signedIn: boolean
): string | null {
  const held = readAnonId(req);
  if (held !== null) return held;
  const state = getState();
  const flags = [...state.featureFlags.values()].map((flag) => ({
    key: flag.key,
    enabled: flag.enabled,
    environments: flag.environments,
    public: flag.public,
    rules: state.featureFlagRules.filter((r) => r.flagId === flag.id)
  }));
  const needed = signedIn
    ? signedInEvaluationNeedsAnonId(flags, evaluationEnv())
    : anonymousEvaluationNeedsAnonId(flags, evaluationEnv());
  if (!needed) return null;
  const issued = randomUUID();
  writeAnonId(res, issued);
  return issued;
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

// Mirrors FeatureFlagResolverService.isEnabledForUserId: the full evaluation
// with no rollout id; a missing flag is false.
export function isFlagEnabledForUser(user: MockUser, key: string): boolean {
  return evaluateAll(userContext(user, null), false).flags[key] === true;
}

// ── Public router ──────────────────────────────────────────────────────────
const publicRouter = Router();

publicRouter.get('/', (req, res) => {
  const authenticated = authenticateRequest(req);
  const anonId = resolveAnonId(req, res, authenticated !== null);
  const response = authenticated
    ? evaluateAll(
        userContext(authenticated.user, anonId),
        /* publicOnly */ false
      )
    : evaluateAll(anonymousContext(anonId), true);
  res.json(response);
});

// ── Admin router ───────────────────────────────────────────────────────────
const adminRouter = Router();

adminRouter.get(
  '/cursor',
  permissionGuard('search', 'FeatureFlag'),
  (req, res) => {
    const query = req.query as Record<string, unknown>;
    const errors = listQueryErrors(query, FEATURE_FLAG_LIST_QUERY);
    if (errors.length > 0) {
      res.status(400).json(validationError(errors));
      return;
    }
    const page = listPage(
      filterByAbility(
        Array.from(getState().featureFlags.values()),
        (req as AuthenticatedRequest).user,
        'search',
        'FeatureFlag'
      ),
      FEATURE_FLAG_LIST_QUERY,
      query
    );
    res.json({ data: page.data.map(toFeatureFlagResponse), meta: page.meta });
  }
);

// Mirrors GET /admin/feature-flags/attribute-keys. Declared above the /:id
// handler so the literal segment wins, as /cursor is.
adminRouter.get(
  '/attribute-keys',
  permissionGuard('search', 'FeatureFlag'),
  (_req, res) => {
    const body: FeatureFlagAttributeKeysResponse = {
      customKeys: Array.from(KNOWN_CUSTOM_KEYS).sort()
    };
    res.json(body);
  }
);

adminRouter.get(
  '/:id',
  permissionGuard('read', 'FeatureFlag'),
  requireUuid('id'),
  (req, res) => {
    const flag = getState().featureFlags.get(
      (req.params['id'] as string) ?? ''
    );
    if (!flag) {
      sendError(
        res,
        404,
        'Feature flag not found',
        ErrorKeys.FEATURE_FLAGS.NOT_FOUND
      );
      return;
    }
    if (!assertInstancePermission(req, res, 'read', 'FeatureFlag', flag)) {
      return;
    }
    res.json(toFeatureFlagResponse(flag));
  }
);

function rulesOf(body: {
  rules?: unknown;
}): ReturnType<typeof parseRules> | null {
  return body.rules === undefined || body.rules === null
    ? null
    : parseRules(body.rules);
}

// Staggered createdAt keeps the request order, as clock_timestamp() does on the server.
function writeRules(
  flagId: string,
  rules: ValidatedRule[],
  updatedAt: string
): void {
  const state = getState();
  state.featureFlagRules = state.featureFlagRules.filter(
    (r) => r.flagId !== flagId
  );
  const start = Date.parse(updatedAt);
  rules.forEach((r, i) => {
    const rule: MockFeatureFlagRule = {
      id: randomUUID(),
      flagId,
      type: r.type,
      effect: r.effect,
      payload: r.payload,
      createdAt: new Date(start + i).toISOString(),
      updatedAt
    };
    state.featureFlagRules.push(rule);
  });
}

adminRouter.post('/', permissionGuard('create', 'FeatureFlag'), (req, res) => {
  const body = req.body as CreateFlagBody;
  const validation = validateCreate(body);
  if (!validation.ok) {
    res.status(400).json(validationError(validation.message));
    return;
  }
  const rules = rulesOf(body);
  // The record as the server writes it, defaults included.
  if (
    !assertInstancePermission(req, res, 'create', 'FeatureFlag', {
      key: validation.data.key,
      description: validation.data.description,
      enabled: validation.data.enabled,
      environments: validation.data.environments,
      public: validation.data.isPublic
    })
  ) {
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
  if (rules && !rules.ok) {
    sendError(res, 400, rules.message);
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
  if (rules) writeRules(flag.id, rules.rules, now);
  logAudit('FEATURE_FLAG_CREATE', {
    actorId: actorIdFromReq(req),
    targetId: flag.id,
    targetType: 'FeatureFlag',
    details: {
      key: flag.key,
      flagId: flag.id,
      ...(rules ? { ruleCount: rules.rules.length } : {})
    }
  });
  broadcastFlagsUpdated();
  res.status(201).json(toFeatureFlagResponse(flag));
});

adminRouter.patch(
  '/:id',
  permissionGuard('update', 'FeatureFlag'),
  requireUuid('id'),
  (req, res) => {
    // Order mirrors the server: the global ValidationPipe rejects the body
    // before the handler reads If-Match, and both precede the service lookup.
    const body = req.body as UpdateFlagBody;
    const validation = validateUpdate(body);
    if (!validation.ok) {
      res.status(400).json(validationError(validation.message));
      return;
    }
    const rules = rulesOf(body);
    const ifMatch = parseIfMatch(req.header('if-match') ?? undefined);
    if (!ifMatch.ok) {
      sendError(res, ifMatch.status, ifMatch.message, ifMatch.errorKey);
      return;
    }
    const flag = getState().featureFlags.get(
      (req.params['id'] as string) ?? ''
    );
    if (!flag) {
      sendError(
        res,
        404,
        'Feature flag not found',
        ErrorKeys.FEATURE_FLAGS.NOT_FOUND
      );
      return;
    }
    // The record after the write is checked too, as on the server.
    const after = {
      ...flag,
      ...(validation.patch.description !== undefined
        ? { description: validation.patch.description }
        : {}),
      ...(validation.patch.enabled !== undefined
        ? { enabled: validation.patch.enabled }
        : {}),
      ...(validation.patch.environments !== undefined
        ? { environments: validation.patch.environments }
        : {}),
      ...(validation.patch.isPublic !== undefined
        ? { public: validation.patch.isPublic }
        : {})
    };
    if (
      !assertInstancePermission(req, res, 'update', 'FeatureFlag', flag) ||
      !assertInstancePermission(req, res, 'update', 'FeatureFlag', after)
    ) {
      return;
    }
    if (rules && !rules.ok) {
      sendError(res, 400, rules.message);
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
    const changed = changedFields(flag, {
      description: validation.patch.description,
      enabled: validation.patch.enabled,
      environments: validation.patch.environments,
      public: validation.patch.isPublic
    });
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
    if (rules) writeRules(flag.id, rules.rules, flag.updatedAt);
    logAudit('FEATURE_FLAG_UPDATE', {
      actorId: actorIdFromReq(req),
      targetId: flag.id,
      targetType: 'FeatureFlag',
      details: {
        changedFields: changed,
        ...(rules ? { ruleCount: rules.rules.length } : {})
      }
    });
    broadcastFlagsUpdated();
    res.json(toFeatureFlagResponse(flag));
  }
);

adminRouter.delete(
  '/:id',
  permissionGuard('delete', 'FeatureFlag'),
  requireUuid('id'),
  (req, res) => {
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
    if (!assertInstancePermission(req, res, 'delete', 'FeatureFlag', flag)) {
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
  }
);

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
      maxItems: FEATURE_FLAG_ROLE_NAMES_MAX_ITEMS,
      maxItemLength: ROLE_NAME_MAX_LENGTH,
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

adminRouter.post(
  '/:id/preview',
  permissionGuard('read', 'FeatureFlag'),
  requireUuid('id'),
  (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    // The server resolves the body through the ValidationPipe before the handler
    // runs, so every DTO-level rejection precedes the 404, and the pipe reports
    // all of them together. Only the rule-payload validator lives in the service,
    // below the lookup.
    const errors = [
      ...previewContextErrors(body),
      ...rulesErrors(body['rules'], 'nullable'),
      ...booleanErrors('enabled', body['enabled'], 'definedOnly'),
      ...environmentErrors(body['environments'])
    ];
    if (errors.length > 0) {
      res.status(400).json(validationError(errors));
      return;
    }
    const flag = getState().featureFlags.get(
      (req.params['id'] as string) ?? ''
    );
    if (!flag) {
      sendError(
        res,
        404,
        'Feature flag not found',
        ErrorKeys.FEATURE_FLAGS.NOT_FOUND
      );
      return;
    }
    if (!assertInstancePermission(req, res, 'read', 'FeatureFlag', flag)) {
      return;
    }
    const draftRules = rulesOf(body);
    if (draftRules && !draftRules.ok) {
      sendError(res, 400, draftRules.message);
      return;
    }
    const draftEnvironments =
      body['environments'] === undefined
        ? undefined
        : normalizedEnvironments(body['environments']);
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
    const rules: EvaluatorRule[] = draftRules?.ok
      ? draftRules.rules.map((r) => ({
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
  }
);

export {
  publicRouter as featureFlagsRouter,
  adminRouter as featureFlagsAdminRouter
};
