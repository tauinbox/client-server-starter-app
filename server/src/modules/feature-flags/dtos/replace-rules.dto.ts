import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { FeatureFlagRuleDto } from './feature-flag-rule.dto';

export class ReplaceRulesDto {
  @ApiProperty({ type: [FeatureFlagRuleDto] })
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => FeatureFlagRuleDto)
  rules: FeatureFlagRuleDto[];
}
