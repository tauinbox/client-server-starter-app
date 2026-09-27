import { ApiProperty } from '@nestjs/swagger';
import type { ActiveSessionResponse } from '@app/shared/types';

export class ActiveSessionResponseDto implements ActiveSessionResponse {
  @ApiProperty({
    description: 'Session id. It survives a token refresh.',
    format: 'uuid'
  })
  id: string;

  @ApiProperty({ description: 'True for the session of the calling device' })
  current: boolean;

  @ApiProperty({
    description:
      'User-Agent the device sent when it signed in. Null when none was recorded.',
    type: String,
    nullable: true
  })
  userAgent: string | null;

  @ApiProperty({
    description:
      'IP address of the last sign-in or token refresh of the session. Null ' +
      'when none was recorded.',
    type: String,
    nullable: true
  })
  ipAddress: string | null;

  @ApiProperty({
    description:
      'ISO 3166-1 alpha-2 country resolved from the IP address. Null when ' +
      'it is unknown.',
    type: String,
    nullable: true,
    example: 'DE'
  })
  countryCode: string | null;

  @ApiProperty({
    description:
      'City (English name) resolved from the IP address. Null when it is ' +
      'unknown.',
    type: String,
    nullable: true
  })
  city: string | null;

  @ApiProperty({ description: 'When the session started', format: 'date-time' })
  startedAt: string;

  @ApiProperty({
    description:
      'When the device last refreshed its access token. This lags real ' +
      'activity by up to one access-token lifetime.',
    format: 'date-time'
  })
  lastActiveAt: string;
}
