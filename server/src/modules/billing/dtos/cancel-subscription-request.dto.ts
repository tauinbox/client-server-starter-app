import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { CancelMode } from '../providers/payment-provider.interface';

export class CancelSubscriptionRequestDto {
  @ApiPropertyOptional({
    description:
      'When the cancellation takes effect. Defaults to the end of the current paid period.',
    enum: ['period_end', 'immediate'],
    default: 'period_end'
  })
  @IsOptional()
  @IsIn(['period_end', 'immediate'])
  mode?: CancelMode;
}
