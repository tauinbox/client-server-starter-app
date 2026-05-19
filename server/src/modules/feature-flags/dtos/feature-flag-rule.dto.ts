import { IsIn, IsInt, IsObject, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type {
  FeatureFlagRuleEffect,
  FeatureFlagRulePayload,
  FeatureFlagRuleType
} from '@app/shared/types';

const RULE_TYPES: FeatureFlagRuleType[] = [
  'user',
  'role',
  'percentage',
  'attribute'
];

const RULE_EFFECTS: FeatureFlagRuleEffect[] = ['include', 'exclude'];

export class FeatureFlagRuleDto {
  @ApiProperty({ enum: RULE_EFFECTS })
  @IsIn(RULE_EFFECTS)
  effect: FeatureFlagRuleEffect;

  @ApiProperty({ minimum: 0, example: 0 })
  @IsInt()
  @Min(0)
  priority: number;

  @ApiProperty({ enum: RULE_TYPES })
  @IsIn(RULE_TYPES)
  type: FeatureFlagRuleType;

  @ApiProperty({
    description:
      'Discriminated payload — shape depends on `type`. Validated server-side by the rule-payload validator.'
  })
  @IsObject()
  payload: FeatureFlagRulePayload;
}
