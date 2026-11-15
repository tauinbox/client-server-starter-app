import { applyDecorators } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { COUNTRY_CODES, type CountryCode } from '@app/shared/constants';
import { CreateUserDto } from '../../users/dtos/create-user.dto';

/** The rules of a declared country of residence, for every sign-up body. */
function ResidenceCountryProperty(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      description:
        'The declared country of residence (ISO 3166-1 alpha-2). It selects the data region; a country of another region is refused.',
      enum: COUNTRY_CODES,
      example: 'DE'
    }),
    IsIn([...COUNTRY_CODES], {
      message: 'residenceCountry must be an ISO 3166-1 alpha-2 country code'
    })
  );
}

/** The body that creates the account of a provider identity. */
export class OAuthSignupDto {
  @ResidenceCountryProperty()
  residenceCountry: CountryCode;
}

export class RegisterDto extends CreateUserDto {
  @ApiPropertyOptional({
    description:
      'Cloudflare Turnstile token. Required when the IP is near the rate limit (X-RateLimit-Remaining ≤ 1) and CAPTCHA is enabled on the server.'
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  captchaToken?: string;

  @ResidenceCountryProperty()
  residenceCountry: CountryCode;
}
