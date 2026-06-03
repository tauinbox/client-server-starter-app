import { ApiProperty } from '@nestjs/swagger';
import type {
  BillingMode,
  BillingProviderId,
  PlanInterval,
  PlanPrice,
  PlanResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class PlanResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'pro' })
  key: string;

  @ApiProperty({ example: 'Pro' })
  name: string;

  @ApiProperty({ example: 'For growing teams', nullable: true })
  description: string | null;

  @ApiProperty({ enum: ['fixed', 'usage'], example: 'fixed' })
  billingMode: BillingMode;

  @ApiProperty({ enum: ['month', 'year'], example: 'month' })
  interval: PlanInterval;

  @ApiProperty({ example: null, nullable: true })
  meterKey: string | null;

  @ApiProperty({ type: [String], example: ['reports', 'api-access'] })
  entitlements: string[];

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    nullable: true,
    example: { records: 10000 }
  })
  limits: Record<string, number> | null;

  @ApiProperty({ example: 0 })
  trialDays: number;

  @ApiProperty({ example: true })
  active: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      yookassa: { currency: 'RUB', amountMinor: 99000 },
      paddle: { currency: 'USD', amountMinor: 1200 }
    }
  })
  prices: Partial<Record<BillingProviderId, PlanPrice>>;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  updatedAt: Date;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<PlanResponseDto>, PlanResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<PlanResponse, WireType<PlanResponseDto>>
>;
