import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateUserDto } from '../../users/dtos/create-user.dto';

export class RegisterDto extends CreateUserDto {
  @ApiPropertyOptional({
    description:
      'Cloudflare Turnstile token. Required when the IP is near the rate limit (X-RateLimit-Remaining ≤ 1) and CAPTCHA is enabled on the server.'
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  captchaToken?: string;
}
