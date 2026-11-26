import type { ValueTransformer } from 'typeorm';
import type { FeatureFlagRulePayload } from '@app/shared/types';

/**
 * The payload as the settings row stores it. The members of a `user` rule are
 * personal data, so they live in the regional `feature_flag_rule_users` rows,
 * and the stored payload holds only the type.
 */
type StoredFeatureFlagRulePayload =
  Exclude<FeatureFlagRulePayload, { type: 'user' }> | { type: 'user' };

/** Every ORM write of a rule row stores the payload with no member ids. */
export const storedRulePayloadTransformer: ValueTransformer = {
  to(value?: FeatureFlagRulePayload): StoredFeatureFlagRulePayload | undefined {
    if (value?.type === 'user') return { type: 'user' };

    return value;
  },
  // A read gives a `user` rule an empty member list; `attachRuleMembers`
  // fills it from the member rows.
  from(value: StoredFeatureFlagRulePayload): FeatureFlagRulePayload {
    return value.type === 'user' ? { type: 'user', userIds: [] } : value;
  }
};
