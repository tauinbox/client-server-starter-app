import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MIN_PASSWORD_LENGTH } from '@app/shared/constants';
import { IsNewPassword } from '../../../common/validators/is-new-password';

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
  @IsNewPassword()
  password: string;
}
