import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { BillingRegion } from '@app/shared/types';

export class RegionRequestDto {
  @ApiProperty({
    description:
      'Billing region for the next checkout. "auto" clears the override (geo decides); "ru" pins YooKassa; "world" pins Paddle.',
    enum: ['auto', 'ru', 'world'],
    example: 'auto'
  })
  @IsIn(['auto', 'ru', 'world'])
  region: BillingRegion;
}
