import { IsIn, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  FEATURE_FLAG_RULE_EFFECTS,
  type FeatureFlagRuleEffect
} from '@app/shared/constants';
import type { FeatureFlagRulePayload } from '@app/shared/types';

export class FeatureFlagRuleDto {
  @ApiProperty({ enum: FEATURE_FLAG_RULE_EFFECTS })
  @IsIn(FEATURE_FLAG_RULE_EFFECTS)
  effect: FeatureFlagRuleEffect;

  @ApiProperty({
    description:
      'Discriminated payload — shape depends on `payload.type`. Validated server-side by the rule-payload validator.'
  })
  @IsObject()
  payload: FeatureFlagRulePayload;
}
