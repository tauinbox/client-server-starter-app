import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ANON_ID_PATTERN,
  APP_ENVIRONMENTS,
  FEATURE_FLAG_ROLE_NAMES_MAX_ITEMS,
  ROLE_NAME_MAX_LENGTH,
  normalizeEnvironmentList
} from '@app/shared/constants';
import { findPreviewAttributesError } from '@app/shared/utils/feature-flag-preview-attributes';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';
import { FeatureFlagRuleDto } from './feature-flag-rule.dto';

@ValidatorConstraint({ name: 'previewAttributes', async: false })
class PreviewAttributesConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return findPreviewAttributesError(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return findPreviewAttributesError(args.value) ?? '';
  }
}

export class PreviewFlagContextDto {
  @ApiPropertyOptional({
    description: 'Optional synthetic user id to drive user / percentage rules.',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Synthetic role names for role-rule evaluation.',
    type: [String],
    example: ['beta-tester']
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(FEATURE_FLAG_ROLE_NAMES_MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(ROLE_NAME_MAX_LENGTH, { each: true })
  roles?: string[];

  @ApiPropertyOptional({
    description:
      'Attribute map for attribute-rule evaluation. Keys are bounded in length and count; values are arbitrary JSON.',
    example: { email: 'tester@example.com', emailDomain: 'example.com' },
    type: 'object',
    additionalProperties: true
  })
  @IsOptional()
  @IsObject()
  @Validate(PreviewAttributesConstraint)
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Synthetic environment. Falls back to the active server environment when omitted.',
    enum: APP_ENVIRONMENTS,
    example: 'staging'
  })
  @IsOptional()
  @IsIn(APP_ENVIRONMENTS)
  env?: string;

  @ApiPropertyOptional({
    description:
      'Synthetic anonymous id (drives percentage-rule bucketing for guests). It has the UUID shape of the rollout cookie.',
    example: '0b6f2c1e-7d4a-4c1b-9e2f-3a5d8c7b6e10'
  })
  @IsOptional()
  @Matches(ANON_ID_PATTERN, { message: 'anonId must be a UUID' })
  anonId?: string;

  @ApiPropertyOptional({
    description:
      'Unsaved rule set to evaluate instead of the persisted rules. Validated with the same rules as the `rules` field of a save.',
    type: [FeatureFlagRuleDto]
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => FeatureFlagRuleDto)
  rules?: FeatureFlagRuleDto[];

  @ApiPropertyOptional({
    description: 'Unsaved enabled state to evaluate instead of the stored one.'
  })
  @ValidateIf(propertyIsDefined)
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Unsaved environment list to evaluate instead of the stored one.',
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
}
