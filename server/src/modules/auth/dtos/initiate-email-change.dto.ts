import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { normalizeEmail } from '@app/shared/utils/email';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

export class InitiateEmailChangeDto {
  @ApiProperty({
    description: 'New email address to change to',
    example: 'new.user@example.com'
  })
  @Transform(({ value }: { value: unknown }) => normalizeEmail(value) ?? value)
  @IsEmail()
  @MaxLength(255)
  newEmail: string;

  @ApiPropertyOptional({
    description:
      'Current password. An account that holds one must supply it. An account ' +
      'created through a provider holds none and authorizes the change with a ' +
      're-authentication proof instead.',
    example: 'CurrentPassword123'
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword?: string;
}
