import { createHash } from 'node:crypto';

import type {
  FeatureFlagAttributeOp,
  FeatureFlagRuleEffect,
  FeatureFlagRulePayload
} from '../types/feature-flag.types';

export type FeatureFlagEvaluationContext = {
  userId: string | null;
  anonId: string | null;
  roles: string[];
  attributes: Record<string, unknown>;
  env: string;
};

export type EvaluatorFlag = {
  key: string;
  enabled: boolean;
  environments: readonly string[];
};

export type EvaluatorRule = {
  priority: number;
  effect: FeatureFlagRuleEffect;
  payload: FeatureFlagRulePayload;
};

export function evaluateFeatureFlag(
  flag: EvaluatorFlag,
  rules: readonly EvaluatorRule[],
  ctx: FeatureFlagEvaluationContext
): boolean {
  if (!flag.enabled) return false;
  if (flag.environments.length > 0 && !flag.environments.includes(ctx.env)) {
    return false;
  }

  const sortedExcludes = rules
    .filter((r) => r.effect === 'exclude')
    .slice()
    .sort((a, b) => a.priority - b.priority);
  const sortedIncludes = rules
    .filter((r) => r.effect === 'include')
    .slice()
    .sort((a, b) => a.priority - b.priority);

  for (const rule of sortedExcludes) {
    if (matchesRule(rule.payload, flag.key, ctx)) return false;
  }

  if (sortedIncludes.length === 0) return true;

  for (const rule of sortedIncludes) {
    if (matchesRule(rule.payload, flag.key, ctx)) return true;
  }
  return false;
}

function matchesRule(
  payload: FeatureFlagRulePayload,
  flagKey: string,
  ctx: FeatureFlagEvaluationContext
): boolean {
  switch (payload.type) {
    case 'user':
      return ctx.userId !== null && payload.userIds.includes(ctx.userId);
    case 'role':
      return ctx.roles.some((r) => payload.roleNames.includes(r));
    case 'percentage': {
      const id = ctx.userId ?? ctx.anonId;
      if (id === null) return false;
      return percentageBucket(id, flagKey) < payload.percent;
    }
    case 'attribute':
      return matchesAttribute(payload, ctx);
  }
}

function matchesAttribute(
  payload: Extract<FeatureFlagRulePayload, { type: 'attribute' }>,
  ctx: FeatureFlagEvaluationContext
): boolean {
  const fieldKey =
    payload.field === 'custom' ? payload.customKey : payload.field;
  if (fieldKey === undefined || fieldKey === '') return false;
  const actual = ctx.attributes[fieldKey];
  return matchesAttributeOp(actual, payload.op, payload.value);
}

function matchesAttributeOp(
  actual: unknown,
  op: FeatureFlagAttributeOp,
  expected: unknown
): boolean {
  switch (op) {
    case 'eq':
      return actual === expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'endsWith':
      return (
        typeof actual === 'string' &&
        typeof expected === 'string' &&
        actual.endsWith(expected)
      );
    case 'before': {
      const a = toTimestamp(actual);
      const b = toTimestamp(expected);
      return a !== null && b !== null && a < b;
    }
    case 'after': {
      const a = toTimestamp(actual);
      const b = toTimestamp(expected);
      return a !== null && b !== null && a > b;
    }
  }
}

function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

export function percentageBucket(id: string, flagKey: string): number {
  const digest = createHash('sha256').update(`${id}:${flagKey}`).digest();
  return digest.readUInt32BE(0) % 100;
}
