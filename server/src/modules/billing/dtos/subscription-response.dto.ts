import { ApiProperty } from '@nestjs/swagger';
import type {
  BillingMode,
  BillingProviderId,
  StructuralDiff,
  SubscriptionResponse,
  SubscriptionStatus,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class SubscriptionResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  customerId: string;

  @ApiProperty({ example: 'pro' })
  planKey: string;

  @ApiProperty({ enum: ['paddle', 'yookassa'], example: 'paddle' })
  provider: BillingProviderId;

  @ApiProperty({ enum: ['fixed', 'usage'], example: 'fixed' })
  billingMode: BillingMode;

  @ApiProperty({
    enum: ['incomplete', 'trialing', 'active', 'past_due', 'canceled'],
    example: 'active'
  })
  status: SubscriptionStatus;

  @ApiProperty({ enum: ['provider', 'self'], example: 'provider' })
  lifecycleOwner: 'provider' | 'self';

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  currentPeriodStart: Date;

  @ApiProperty({ example: '2023-02-01T00:00:00Z' })
  currentPeriodEnd: Date;

  @ApiProperty({ example: false })
  cancelAtPeriodEnd: boolean;

  @ApiProperty({ nullable: true, example: null })
  trialEnd: Date | null;

  @ApiProperty({ nullable: true, example: null })
  paymentMethodId: string | null;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  updatedAt: Date;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<SubscriptionResponseDto>, SubscriptionResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<SubscriptionResponse, WireType<SubscriptionResponseDto>>
>;
