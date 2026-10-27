import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  MaxLength,
  ValidateIf
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { normalizeEmail } from '@app/shared/utils/email';
import {
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  SUPPORTED_LOCALES
} from '@app/shared/constants';
import { IsNewPassword } from '../../../common/validators/is-new-password';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

export class CreateUserDto {
  @ApiProperty({
    description: 'The email of the user',
    example: 'user@example.com'
  })
  @Transform(({ value }: { value: unknown }) => normalizeEmail(value) ?? value)
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  email: string;

  @ApiProperty({
    description: 'The full name of the user, in the order the user writes it',
    example: 'John Doe'
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value
  )
  @IsNotEmpty()
  @MaxLength(MAX_NAME_LENGTH)
  name: string;

  @ApiProperty({
    description:
      'The password of the user. Rejected when it appears in a public breach corpus.',
    example: 'Sunrise-Kettle-19',
    minLength: MIN_PASSWORD_LENGTH
  })
  @IsNewPassword()
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
