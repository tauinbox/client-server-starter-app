import type { FeatureFlag } from './feature-flag.entity';
import type { FeatureFlagResponse, _AssertNever } from '@app/shared/types';

type _EntityFieldCoverage = _AssertNever<
  Exclude<keyof FeatureFlag, keyof FeatureFlagResponse>
>;

type _ResponseFieldCoverage = _AssertNever<
  Exclude<keyof FeatureFlagResponse, keyof FeatureFlag>
>;
