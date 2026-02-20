import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';
import {
  PASSWORD_REGEX,
  PASSWORD_ERROR
} from '@app/shared/constants/password.constants';

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Password reset token'
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    description:
      'New password (min 8 characters, must contain uppercase, lowercase and number)',
    minLength: 8
  })
  @IsNotEmpty()
  @MinLength(8)
  @Matches(PASSWORD_REGEX, { message: PASSWORD_ERROR })
  password: string;
}
