import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  APP_ENVIRONMENTS,
  FEATURE_FLAG_DESCRIPTION_MAX_LENGTH,
  FEATURE_FLAG_KEY_MAX_LENGTH,
  FEATURE_FLAG_KEY_MIN_LENGTH,
  FEATURE_FLAG_KEY_PATTERN,
  FEATURE_FLAG_RULES_MAX_ITEMS,
  normalizeEnvironmentList
} from '@app/shared/constants';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';
import { FeatureFlagRuleDto } from './feature-flag-rule.dto';

export class CreateFeatureFlagDto {
  @ApiProperty({
    description:
      'Stable identifier used by code. Lowercase letters, digits, hyphens.',
    example: 'new-dashboard'
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value
  )
  @IsString()
  @MinLength(FEATURE_FLAG_KEY_MIN_LENGTH)
  @MaxLength(FEATURE_FLAG_KEY_MAX_LENGTH)
  @Matches(FEATURE_FLAG_KEY_PATTERN)
  key: string;

  @ApiPropertyOptional({ example: 'New dashboard rollout' })
  @IsOptional()
  @IsString()
  @MaxLength(FEATURE_FLAG_DESCRIPTION_MAX_LENGTH)
  description?: string;

  @ApiPropertyOptional({ default: false })
  @ValidateIf(propertyIsDefined)
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'When empty, flag applies to all environments. Names are lowercased and de-duplicated.',
    example: ['production', 'staging'],
    enum: APP_ENVIRONMENTS,
    isArray: true
  })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? normalizeEnvironmentList(value) : value
  )
  @ValidateIf(propertyIsDefined)
  @IsArray()
  @ArrayMaxSize(APP_ENVIRONMENTS.length)
  @IsString({ each: true })
  @IsIn(APP_ENVIRONMENTS, { each: true })
  environments?: string[];

  @ApiPropertyOptional({
    description: 'Visible to anonymous users via the public endpoint.',
    default: false
  })
  @ValidateIf(propertyIsDefined)
  @IsBoolean()
  public?: boolean;

  @ApiPropertyOptional({
    description:
      'The full rule set. When present, it replaces the stored rules in the same transaction as the flag write. When omitted, the rules stay unchanged.',
    type: [FeatureFlagRuleDto]
  })
  @ValidateIf(propertyIsDefined)
  @IsArray()
  @ArrayMaxSize(FEATURE_FLAG_RULES_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => FeatureFlagRuleDto)
  rules?: FeatureFlagRuleDto[];
}
