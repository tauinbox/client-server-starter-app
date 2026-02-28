import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../../users/dtos/user-response.dto';

export class TokensResponseDto {
  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  })
  access_token: string;

  @ApiHideProperty()
  refresh_token: string;

  @ApiProperty({
    description: 'Access token expiration time in seconds',
    example: 3600
  })
  expires_in: number;
}

export class AuthResponseDto {
  @ApiProperty({
    description: 'Authentication tokens',
    type: TokensResponseDto
  })
  tokens: TokensResponseDto;

  @ApiProperty({
    description: 'User information',
    type: UserResponseDto
  })
  user: UserResponseDto;
}
