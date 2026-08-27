import type { FeatureFlagAttributeOp } from '@app/shared/constants';
import type { FeatureFlagRulePayload } from '@app/shared/types';
import { attributeValueError } from '@app/shared/utils/feature-flag-attribute-value';

const VALUE_ERROR_KEYS: Record<FeatureFlagAttributeOp, string> = {
  eq: 'admin.featureFlagRule.errorValueInvalid',
  in: 'admin.featureFlagRule.errorValueListRequired',
  endsWith: 'admin.featureFlagRule.errorValueRequired',
  before: 'admin.featureFlagRule.errorValueDate',
  after: 'admin.featureFlagRule.errorValueDate'
};

/**
 * Translation key for the reason `PUT /admin/feature-flags/:id/rules` would
 * reject this draft, or null when the server accepts it. The value check is
 * delegated to the shared `attributeValueError`, so the two cannot drift.
 *
 * Two server checks are deliberately absent. An empty user or role list is a
 * valid rule that matches nobody, and the registered-custom-key set is filled
 * at boot from the environment, so only the server can test membership.
 */
export function featureFlagRuleError(
  payload: FeatureFlagRulePayload
): string | null {
  if (payload.type !== 'attribute') return null;
  if (payload.field === 'custom' && (payload.customKey ?? '').trim() === '') {
    return 'admin.featureFlagRule.errorCustomKeyRequired';
  }
  if (attributeValueError(payload.op, payload.value) === null) return null;
  return VALUE_ERROR_KEYS[payload.op];
}
