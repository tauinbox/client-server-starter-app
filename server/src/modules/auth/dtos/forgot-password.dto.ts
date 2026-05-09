import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class ForgotPasswordDto {
  @ApiProperty({
    description: 'Email address to send password reset link to',
    example: 'user@example.com'
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value
  )
  @IsEmail()
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
