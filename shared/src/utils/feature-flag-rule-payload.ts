import {
  FEATURE_FLAG_ATTRIBUTE_FIELD_OPS,
  FEATURE_FLAG_ATTRIBUTE_FIELDS,
  FEATURE_FLAG_ATTRIBUTE_OPS,
  FEATURE_FLAG_BUCKET_BY,
  FEATURE_FLAG_ROLE_NAMES_MAX_ITEMS,
  type FeatureFlagAttributeField,
  type FeatureFlagAttributeOp,
  type FeatureFlagBucketBy,
  type FeatureFlagRuleType
} from '../constants/feature-flag.constants';
import { MAX_PAGE_SIZE } from '../constants/pagination.constants';
import { ROLE_NAME_MAX_LENGTH } from '../constants/permission.constants';
import { UUID_PATTERN } from '../constants/uuid.constants';
import type { FeatureFlagRulePayload } from '../types/feature-flag.types';
import { attributeValueError } from './feature-flag-attribute-value';

export type FeatureFlagRulePayloadResult =
  | { ok: true; payload: FeatureFlagRulePayload }
  | { ok: false; message: string };

const fail = (message: string): FeatureFlagRulePayloadResult => ({
  ok: false,
  message
});

function isBoundedArray<T>(
  value: unknown,
  maxItems: number,
  isItem: (item: unknown) => item is T
): value is T[] {
  return (
    Array.isArray(value) && value.length <= maxItems && value.every(isItem)
  );
}

const isUserId = (v: unknown): v is string =>
  typeof v === 'string' && UUID_PATTERN.test(v);

const isRoleName = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= ROLE_NAME_MAX_LENGTH;

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
      if (!isBoundedArray(userIds, MAX_PAGE_SIZE, isUserId)) {
        return fail(
          `user rule requires userIds: an array of up to ${MAX_PAGE_SIZE} UUIDs`
        );
      }
      return { ok: true, payload: { type: 'user', userIds } };
    }
    case 'role': {
      const roleNames = p['roleNames'];
      if (
        !isBoundedArray(
          roleNames,
          FEATURE_FLAG_ROLE_NAMES_MAX_ITEMS,
          isRoleName
        )
      ) {
        return fail(
          `role rule requires roleNames: an array of up to ${FEATURE_FLAG_ROLE_NAMES_MAX_ITEMS} names of 1-${ROLE_NAME_MAX_LENGTH} characters`
        );
      }
      return { ok: true, payload: { type: 'role', roleNames } };
    }
    case 'percentage': {
      const percent = p['percent'];
      // The bucket is an integer 0-99, so a fraction rounds the share up.
      if (
        typeof percent !== 'number' ||
        !Number.isInteger(percent) ||
        percent < 0 ||
        percent > 100
      ) {
        return fail('percentage rule requires percent: an integer in [0, 100]');
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
      if (
        !FEATURE_FLAG_ATTRIBUTE_FIELD_OPS[
          field as FeatureFlagAttributeField
        ].includes(op as FeatureFlagAttributeOp)
      ) {
        return fail(
          `attribute rule with field=${field} does not support op=${op}`
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
