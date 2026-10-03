import { BadRequestException } from '@nestjs/common';
import type { FeatureFlagRuleType } from '@app/shared/constants';
import type { FeatureFlagRulePayload } from '@app/shared/types';
import { parseFeatureFlagRulePayload } from '@app/shared/utils/feature-flag-rule-payload';

export function validateRulePayload(
  type: FeatureFlagRuleType,
  payload: unknown,
  knownCustomAttributeKeys: ReadonlySet<string>
): FeatureFlagRulePayload {
  const result = parseFeatureFlagRulePayload(
    type,
    payload,
    knownCustomAttributeKeys
  );
  if (!result.ok) throw new BadRequestException(result.message);
  return result.payload;
}
