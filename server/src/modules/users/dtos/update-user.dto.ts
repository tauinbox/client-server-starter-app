import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  Length,
  MaxLength,
  ValidateIf
} from 'class-validator';
import { MAX_PASSWORD_LENGTH, TOTP_DIGITS } from '@app/shared/constants';
import { CreateUserDto } from './create-user.dto';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

// @nestjs/swagger's PartialType (not @nestjs/mapped-types') keeps the inherited
// @ApiProperty metadata; skipNullProperties rejects an explicit null, which
// would otherwise reach a NOT NULL column or wipe the password.
export class UpdateUserDto extends PartialType(CreateUserDto, {
  skipNullProperties: false
}) {
  @ApiPropertyOptional({
    description: 'Whether the user is active',
    example: true
  })
  @ValidateIf(propertyIsDefined)
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Set to true to unlock a locked account',
    example: true
  })
  @ValidateIf(propertyIsDefined)
  @IsBoolean()
  unlockAccount?: boolean;

  // The two step-up factors of the CALLER, not of the target. They are read
  // only when the body changes the password or the email, and they never
  // reach the record.
  @ApiPropertyOptional({
    description:
      'Current password of the caller. Required with a password or email change when the caller holds one.',
    example: 'CurrentPassword123'
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  currentPassword?: string;

  @ApiPropertyOptional({
    description:
      'Code from the authenticator app of the caller. Accepted in place of the current password.',
    example: '123456'
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @Length(TOTP_DIGITS, TOTP_DIGITS)
  code?: string;
}
