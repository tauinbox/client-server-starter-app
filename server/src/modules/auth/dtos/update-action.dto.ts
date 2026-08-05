import { IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

export class UpdateActionDto {
  @ApiPropertyOptional({
    description: 'Human-readable display name',
    example: 'Publish'
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional({
    description: 'Description of what this action does',
    example: 'Publish a record to make it publicly visible'
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @MaxLength(500)
  description?: string;
}
