import type { FeatureFlagRule } from './feature-flag-rule.entity';
import type { FeatureFlagRuleResponse, _AssertNever } from '@app/shared/types';

type _NavigationFields = 'flag';

/**
 * `type` is stored as its own column for indexing/querying, but the wire
 * response carries it inside `payload` (discriminated union on payload.type),
 * so we deliberately exclude it from the response surface.
 */
type _ExcludedFromResponse = 'type';

type _EntityFieldCoverage = _AssertNever<
  Exclude<
    keyof FeatureFlagRule,
    keyof FeatureFlagRuleResponse | _NavigationFields | _ExcludedFromResponse
  >
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof FeatureFlagRuleResponse, keyof FeatureFlagRule>
>;
