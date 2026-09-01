import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { normalizeEmail } from '@app/shared/utils/email';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_ERROR,
  PASSWORD_REGEX,
  SUPPORTED_LOCALES
} from '@app/shared/constants';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

export class CreateUserDto {
  @ApiProperty({
    description: 'The email of the user',
    example: 'user@example.com'
  })
  @Transform(({ value }: { value: unknown }) => normalizeEmail(value) ?? value)
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({
    description: 'The first name of the user',
    example: 'John'
  })
  @IsNotEmpty()
  @MaxLength(255)
  firstName: string;

  @ApiProperty({
    description: 'The last name of the user',
    example: 'Doe'
  })
  @IsNotEmpty()
  @MaxLength(255)
  lastName: string;

  @ApiProperty({
    description:
      'The password of the user (min 8 characters, must contain uppercase, lowercase and number)',
    example: 'Password123',
    minLength: MIN_PASSWORD_LENGTH
  })
  @IsNotEmpty()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(MAX_PASSWORD_LENGTH)
  @Matches(PASSWORD_REGEX, { message: PASSWORD_ERROR })
  password: string;

  @ApiPropertyOptional({
    description: 'Preferred locale for transactional emails',
    enum: SUPPORTED_LOCALES,
    example: 'en'
  })
  @ValidateIf(propertyIsDefined)
  @IsIn([...SUPPORTED_LOCALES])
  locale?: string;
}
