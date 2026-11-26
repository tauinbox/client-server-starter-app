import type { ValueTransformer } from 'typeorm';
import type { FeatureFlagRulePayload } from '@app/shared/types';

/**
 * The payload as the settings row stores it. The members of a `user` rule are
 * personal data, so they live in the regional `feature_flag_rule_users` rows;
 * the stored list stays empty. The key stays because a node of the previous
 * build reads it as an array.
 */
type StoredFeatureFlagRulePayload =
  | Exclude<FeatureFlagRulePayload, { type: 'user' }>
  | { type: 'user'; userIds: [] };

function toStoredRulePayload(
  payload: FeatureFlagRulePayload
): StoredFeatureFlagRulePayload {
  return payload.type === 'user' ? { type: 'user', userIds: [] } : payload;
}

/** Every ORM write of a rule row stores the payload with no member ids. */
export const storedRulePayloadTransformer: ValueTransformer = {
  to(value?: FeatureFlagRulePayload): StoredFeatureFlagRulePayload | undefined {
    return value === undefined ? undefined : toStoredRulePayload(value);
  },
  from(value: StoredFeatureFlagRulePayload): FeatureFlagRulePayload {
    return value;
  }
};
