import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { normalizeEmail } from '@app/shared/utils/email';
import { MAX_EMAIL_LENGTH, MAX_PASSWORD_LENGTH } from '@app/shared/constants';

export class LoginDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com'
  })
  @Transform(({ value }: { value: unknown }) => normalizeEmail(value) ?? value)
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  email: string;

  @ApiProperty({
    description: 'User password',
    example: 'Password123'
  })
  @IsNotEmpty()
  @MaxLength(MAX_PASSWORD_LENGTH)
  password: string;
}
