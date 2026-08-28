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
 * `knownCustomKeys` is the set `GET /admin/feature-flags/attribute-keys`
 * reports. It is filled at boot from the environment, so it cannot be a client
 * constant; pass null while the request is in flight or after it failed, and
 * the membership check is skipped rather than guessed. The key is matched
 * verbatim, as the server matches it - a padded key is a key the server
 * rejects.
 *
 * One server check stays deliberately absent: an empty user or role list is a
 * valid rule that matches nobody.
 */
export function featureFlagRuleError(
  payload: FeatureFlagRulePayload,
  knownCustomKeys: ReadonlySet<string> | null = null
): string | null {
  if (payload.type !== 'attribute') return null;
  if (payload.field === 'custom') {
    const customKey = payload.customKey ?? '';
    if (customKey.trim() === '') {
      return 'admin.featureFlagRule.errorCustomKeyRequired';
    }
    if (knownCustomKeys !== null && !knownCustomKeys.has(customKey)) {
      return 'admin.featureFlagRule.errorCustomKeyUnknown';
    }
  }
  if (attributeValueError(payload.op, payload.value) === null) return null;
  return VALUE_ERROR_KEYS[payload.op];
}
