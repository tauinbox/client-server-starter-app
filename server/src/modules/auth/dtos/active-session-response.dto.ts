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
