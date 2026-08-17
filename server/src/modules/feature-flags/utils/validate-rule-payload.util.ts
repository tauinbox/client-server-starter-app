import { BadRequestException } from '@nestjs/common';
import {
  FEATURE_FLAG_ATTRIBUTE_FIELDS,
  FEATURE_FLAG_ATTRIBUTE_OPS,
  type FeatureFlagAttributeField,
  type FeatureFlagAttributeOp,
  type FeatureFlagRuleType
} from '@app/shared/constants';
import type { FeatureFlagRulePayload } from '@app/shared/types';
import { attributeValueError } from '@app/shared/utils/feature-flag-attribute-value';

export function validateRulePayload(
  type: FeatureFlagRuleType,
  payload: unknown,
  knownCustomAttributeKeys: ReadonlySet<string>
): FeatureFlagRulePayload {
  if (payload === null || typeof payload !== 'object') {
    throw new BadRequestException(`Rule payload must be an object`);
  }
  const p = payload as Record<string, unknown>;

  if (p['type'] !== type) {
    throw new BadRequestException(
      `Rule payload.type "${String(p['type'])}" does not match rule.type "${type}"`
    );
  }

  switch (type) {
    case 'user': {
      const userIds = p['userIds'];
      if (
        !Array.isArray(userIds) ||
        userIds.some((v) => typeof v !== 'string')
      ) {
        throw new BadRequestException(`user rule requires userIds: string[]`);
      }
      return { type: 'user', userIds: userIds as string[] };
    }
    case 'role': {
      const roleNames = p['roleNames'];
      if (
        !Array.isArray(roleNames) ||
        roleNames.some((v) => typeof v !== 'string')
      ) {
        throw new BadRequestException(`role rule requires roleNames: string[]`);
      }
      return { type: 'role', roleNames: roleNames as string[] };
    }
    case 'percentage': {
      const percent = p['percent'];
      if (
        typeof percent !== 'number' ||
        !Number.isFinite(percent) ||
        percent < 0 ||
        percent > 100
      ) {
        throw new BadRequestException(
          `percentage rule requires percent: number in [0, 100]`
        );
      }
      return { type: 'percentage', percent };
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
        throw new BadRequestException(
          `attribute rule requires field ∈ ${FEATURE_FLAG_ATTRIBUTE_FIELDS.join(', ')}`
        );
      }
      if (
        typeof op !== 'string' ||
        !FEATURE_FLAG_ATTRIBUTE_OPS.includes(op as FeatureFlagAttributeOp)
      ) {
        throw new BadRequestException(
          `attribute rule requires op ∈ ${FEATURE_FLAG_ATTRIBUTE_OPS.join(', ')}`
        );
      }
      if (field === 'custom') {
        if (typeof customKey !== 'string' || customKey === '') {
          throw new BadRequestException(
            `attribute rule with field=custom requires customKey: string`
          );
        }
        if (!knownCustomAttributeKeys.has(customKey)) {
          throw new BadRequestException(
            `customKey "${customKey}" is not registered in the attribute registry`
          );
        }
      }
      const valueError = attributeValueError(
        op as FeatureFlagAttributeOp,
        value
      );
      if (valueError) throw new BadRequestException(valueError);
      return {
        type: 'attribute',
        field: field as FeatureFlagAttributeField,
        op: op as FeatureFlagAttributeOp,
        value,
        ...(typeof customKey === 'string' ? { customKey } : {})
      };
    }
  }
}
