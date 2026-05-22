import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const MAX_ATTRIBUTE_KEYS = 32;
const MAX_ATTRIBUTE_KEY_LENGTH = 64;

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
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
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
  attributes?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Synthetic environment label. Falls back to the active server environment when omitted.',
    example: 'staging'
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  env?: string;

  @ApiPropertyOptional({
    description:
      'Synthetic anonymous id (drives percentage-rule bucketing for guests).',
    example: 'anon-42'
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  anonId?: string;
}

export function sanitizeAttributes(
  attrs: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!attrs) return {};
  const entries = Object.entries(attrs).slice(0, MAX_ATTRIBUTE_KEYS);
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (typeof key !== 'string') continue;
    if (key.length === 0 || key.length > MAX_ATTRIBUTE_KEY_LENGTH) continue;
    out[key] = value;
  }
  return out;
}
