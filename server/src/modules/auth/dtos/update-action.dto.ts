import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateActionDto {
  @ApiPropertyOptional({
    description: 'Human-readable display name',
    example: 'Publish'
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Description of what this action does',
    example: 'Publish a record to make it publicly visible'
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
