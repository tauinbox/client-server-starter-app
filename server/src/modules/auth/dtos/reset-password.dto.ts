import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength
} from 'class-validator';
import { PASSWORD_ERROR, PASSWORD_REGEX } from '@app/shared/constants';

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
      'New password (min 8 characters, must contain uppercase, lowercase and number)',
    minLength: 8
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_REGEX, { message: PASSWORD_ERROR })
  password: string;
}
