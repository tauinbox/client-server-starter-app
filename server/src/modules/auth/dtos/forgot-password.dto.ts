import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizeEmail } from '@app/shared/utils/email';
import { MAX_EMAIL_LENGTH } from '@app/shared/constants';

export class ForgotPasswordDto {
  @ApiProperty({
    description: 'Email address to send password reset link to',
    example: 'user@example.com'
  })
  @Transform(({ value }: { value: unknown }) => normalizeEmail(value) ?? value)
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  email: string;

  @ApiPropertyOptional({
    description:
      'Cloudflare Turnstile token. Required when the IP is near the rate limit (X-RateLimit-Remaining ≤ 1) and CAPTCHA is enabled on the server.'
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  captchaToken?: string;
}
