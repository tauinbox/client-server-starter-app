import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({
    description: 'Email address to send password reset link to',
    example: 'user@example.com'
  })
  @IsEmail()
  email: string;
}
