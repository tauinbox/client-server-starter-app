import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

export class UpdateResourceDto {
  @ApiPropertyOptional({
    description: 'Human-readable display name',
    example: 'Users'
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Description of the resource',
    example: 'User accounts management',
    nullable: true
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({
    description:
      'Allowed action names for this resource. null means show all default actions.',
    example: ['read', 'update'],
    type: [String],
    nullable: true
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  allowedActionNames?: string[] | null;
}
