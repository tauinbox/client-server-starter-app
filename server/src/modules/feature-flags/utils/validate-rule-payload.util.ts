import { ErrorKeys } from '@app/shared/constants';
import type { FeatureFlagRulePayload } from '@app/shared/types';
import { parseFeatureFlagRulePayload } from '@app/shared/utils/feature-flag-rule-payload';
import { ApiError } from '../../../common/errors/api-error';

export function validateRulePayload(
  payload: unknown,
  knownCustomAttributeKeys: ReadonlySet<string>
): FeatureFlagRulePayload {
  const result = parseFeatureFlagRulePayload(payload, knownCustomAttributeKeys);
  if (!result.ok) {
    throw new ApiError(ErrorKeys.FEATURE_FLAGS.INVALID_RULE, result.message);
  }
  return result.payload;
}
