import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import {
  MAX_NEW_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH
} from '@app/shared/constants';
import { IsWithinPasswordByteLimit } from '../../../common/validators/password-byte-limit.validator';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Password reset token'
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token: string;

  @ApiProperty({
    description:
      'New password. Rejected when it appears in a public breach corpus.',
    minLength: MIN_PASSWORD_LENGTH
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(MAX_NEW_PASSWORD_LENGTH)
  @IsWithinPasswordByteLimit()
  password: string;
}
