import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf
} from 'class-validator';
import {
  PASSWORD_ERROR,
  PASSWORD_REGEX,
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
      'New password (min 8 characters, must contain uppercase, lowercase and number)',
    example: 'NewPassword123',
    minLength: 8
  })
  @ValidateIf(propertyIsDefined)
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_REGEX, { message: PASSWORD_ERROR })
  password?: string;

  @ApiPropertyOptional({
    description:
      'Current password. An account that holds one must supply it to change ' +
      'the password; the service rejects a missing value. An account created ' +
      'through a provider holds none and omits this field.',
    example: 'CurrentPassword123'
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
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
