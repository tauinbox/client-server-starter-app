import { BadRequestException } from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants';
import type { FeatureFlagRulePayload } from '@app/shared/types';
import { parseFeatureFlagRulePayload } from '@app/shared/utils/feature-flag-rule-payload';

export function validateRulePayload(
  payload: unknown,
  knownCustomAttributeKeys: ReadonlySet<string>
): FeatureFlagRulePayload {
  const result = parseFeatureFlagRulePayload(payload, knownCustomAttributeKeys);
  if (!result.ok) {
    throw new BadRequestException({
      message: result.message,
      errorKey: ErrorKeys.FEATURE_FLAGS.INVALID_RULE
    });
  }
  return result.payload;
}
