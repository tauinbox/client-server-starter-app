import {
  FEATURE_FLAG_ATTRIBUTE_FIELDS,
  FEATURE_FLAG_ATTRIBUTE_OPS,
  FEATURE_FLAG_BUCKET_BY,
  type FeatureFlagAttributeField,
  type FeatureFlagAttributeOp,
  type FeatureFlagBucketBy,
  type FeatureFlagRuleType
} from '../constants/feature-flag.constants';
import type { FeatureFlagRulePayload } from '../types/feature-flag.types';
import { attributeValueError } from './feature-flag-attribute-value';

export type FeatureFlagRulePayloadResult =
  | { ok: true; payload: FeatureFlagRulePayload }
  | { ok: false; message: string };

const fail = (message: string): FeatureFlagRulePayloadResult => ({
  ok: false,
  message
});

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function parseFeatureFlagRulePayload(
  type: FeatureFlagRuleType,
  payload: unknown,
  knownCustomKeys: ReadonlySet<string>
): FeatureFlagRulePayloadResult {
  if (payload === null || typeof payload !== 'object') {
    return fail('Rule payload must be an object');
  }
  const p = payload as Record<string, unknown>;

  if (p['type'] !== type) {
    return fail(
      `Rule payload.type "${String(p['type'])}" does not match rule.type "${type}"`
    );
  }

  switch (type) {
    case 'user': {
      const userIds = p['userIds'];
      if (!isStringArray(userIds)) {
        return fail('user rule requires userIds: string[]');
      }
      return { ok: true, payload: { type: 'user', userIds } };
    }
    case 'role': {
      const roleNames = p['roleNames'];
      if (!isStringArray(roleNames)) {
        return fail('role rule requires roleNames: string[]');
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
        return fail('percentage rule requires percent: number in [0, 100]');
      }
      const bucketBy = p['bucketBy'];
      if (
        bucketBy !== undefined &&
        !FEATURE_FLAG_BUCKET_BY.includes(bucketBy as FeatureFlagBucketBy)
      ) {
        return fail(
          `percentage rule bucketBy must be one of ${FEATURE_FLAG_BUCKET_BY.join(', ')}`
        );
      }
      return {
        ok: true,
        payload: {
          type: 'percentage',
          percent,
          ...(bucketBy !== undefined
            ? { bucketBy: bucketBy as FeatureFlagBucketBy }
            : {})
        }
      };
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
        return fail(
          `attribute rule requires field ∈ ${FEATURE_FLAG_ATTRIBUTE_FIELDS.join(', ')}`
        );
      }
      if (
        typeof op !== 'string' ||
        !FEATURE_FLAG_ATTRIBUTE_OPS.includes(op as FeatureFlagAttributeOp)
      ) {
        return fail(
          `attribute rule requires op ∈ ${FEATURE_FLAG_ATTRIBUTE_OPS.join(', ')}`
        );
      }
      if (field === 'custom') {
        if (typeof customKey !== 'string' || customKey === '') {
          return fail(
            'attribute rule with field=custom requires customKey: string'
          );
        }
        if (!knownCustomKeys.has(customKey)) {
          return fail(
            `customKey "${customKey}" is not registered in the attribute registry`
          );
        }
      }
      const valueError = attributeValueError(
        op as FeatureFlagAttributeOp,
        value
      );
      if (valueError) return fail(valueError);
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
