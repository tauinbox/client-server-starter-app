import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateResourceDto {
  @ApiPropertyOptional({
    description: 'Human-readable display name',
    example: 'Users'
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Description of the resource',
    example: 'User accounts management'
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    description:
      'Allowed action names for this resource. null means show all default actions.',
    example: ['read', 'update'],
    type: [String],
    nullable: true
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedActionNames?: string[] | null;
}
