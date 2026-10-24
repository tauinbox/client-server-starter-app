import {
  IsNotEmpty,
  IsString,
  Length,
  MaxLength,
  ValidateIf
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MAX_PASSWORD_LENGTH, TOTP_DIGITS } from '@app/shared/constants';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

/**
 * The factors a step-up accepts in the body. An account created through a
 * provider holds no password, so it sends a code or proves itself with the
 * `reauth_proof` cookie of a provider round trip instead.
 */
export class StepUpFactorsDto {
  @ApiPropertyOptional({
    description:
      'Current password. An account that holds one must supply it, or a code. ' +
      'An account created through a provider holds none and authorizes the ' +
      'change with a code or a re-authentication proof instead.',
    example: 'CurrentPassword123'
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  currentPassword?: string;

  @ApiPropertyOptional({
    description:
      'Code from the authenticator app. Accepted in place of the password or ' +
      'the re-authentication proof, for an account that carries a second factor.',
    example: '123456'
  })
  @ValidateIf(propertyIsDefined)
  @IsString()
  @Length(TOTP_DIGITS, TOTP_DIGITS)
  code?: string;
}
