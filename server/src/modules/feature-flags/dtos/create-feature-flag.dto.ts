import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  APP_ENVIRONMENTS,
  normalizeEnvironmentList
} from '@app/shared/constants';

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

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
  @MinLength(2)
  @MaxLength(100)
  @Matches(KEY_PATTERN)
  key: string;

  @ApiPropertyOptional({ example: 'New dashboard rollout' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
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
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(APP_ENVIRONMENTS.length)
  @IsString({ each: true })
  @IsIn(APP_ENVIRONMENTS, { each: true })
  environments?: string[];

  @ApiPropertyOptional({
    description: 'Visible to anonymous users via the public endpoint.',
    default: false
  })
  @IsOptional()
  @IsBoolean()
  public?: boolean;
}
