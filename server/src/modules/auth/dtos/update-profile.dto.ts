import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf
} from 'class-validator';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  SUPPORTED_LOCALES
} from '@app/shared/constants';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'The first name of the user',
    example: 'John'
  })
  @ValidateIf(propertyIsDefined)
  @IsNotEmpty()
  @MaxLength(255)
  firstName?: string;

  @ApiPropertyOptional({
    description: 'The last name of the user',
    example: 'Doe'
  })
  @ValidateIf(propertyIsDefined)
  @IsNotEmpty()
  @MaxLength(255)
  lastName?: string;

  @ApiPropertyOptional({
    description:
      'New password. Rejected when it appears in a public breach corpus.',
    example: 'Sunrise-Kettle-19',
    minLength: MIN_PASSWORD_LENGTH
  })
  @ValidateIf(propertyIsDefined)
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(MAX_PASSWORD_LENGTH)
  password?: string;

  @ApiPropertyOptional({
    description:
      'Current password. An account that holds one must supply it to change ' +
      'the password; the service rejects a missing value. An account created ' +
      'through a provider holds none and omits this field, and proves itself ' +
      'instead with a reauth_proof cookie minted for the password_set ' +
      'operation by a round trip at its provider.',
    example: 'CurrentPassword123'
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  currentPassword?: string;

  @ApiPropertyOptional({
    description: 'Preferred locale for transactional emails',
    enum: SUPPORTED_LOCALES,
    example: 'en'
  })
  @ValidateIf(propertyIsDefined)
  @IsIn([...SUPPORTED_LOCALES])
  locale?: string;
}
