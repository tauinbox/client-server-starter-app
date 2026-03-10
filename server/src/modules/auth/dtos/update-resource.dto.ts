import { IsOptional, IsString, MaxLength } from 'class-validator';
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
}
