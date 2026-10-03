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
  ValidateIf
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  APP_ENVIRONMENTS,
  FEATURE_FLAG_KEY_MAX_LENGTH,
  FEATURE_FLAG_KEY_MIN_LENGTH,
  FEATURE_FLAG_KEY_PATTERN,
  normalizeEnvironmentList
} from '@app/shared/constants';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

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
  @MaxLength(500)
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
}
