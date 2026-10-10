import type { FeatureFlagRule } from './feature-flag-rule.entity';
import type { FeatureFlagRuleResponse, _AssertNever } from '@app/shared/types';

type _NavigationFields = 'flag';

type _EntityFieldCoverage = _AssertNever<
  Exclude<
    keyof FeatureFlagRule,
    keyof FeatureFlagRuleResponse | _NavigationFields
  >
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof FeatureFlagRuleResponse, keyof FeatureFlagRule>
>;
