import { IsIn, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  FEATURE_FLAG_RULE_EFFECTS,
  FEATURE_FLAG_RULE_TYPES,
  type FeatureFlagRuleEffect,
  type FeatureFlagRuleType
} from '@app/shared/constants';
import type { FeatureFlagRulePayload } from '@app/shared/types';

export class FeatureFlagRuleDto {
  @ApiProperty({ enum: FEATURE_FLAG_RULE_EFFECTS })
  @IsIn(FEATURE_FLAG_RULE_EFFECTS)
  effect: FeatureFlagRuleEffect;

  @ApiProperty({ enum: FEATURE_FLAG_RULE_TYPES })
  @IsIn(FEATURE_FLAG_RULE_TYPES)
  type: FeatureFlagRuleType;

  @ApiProperty({
    description:
      'Discriminated payload — shape depends on `type`. Validated server-side by the rule-payload validator.'
  })
  @IsObject()
  payload: FeatureFlagRulePayload;
}
