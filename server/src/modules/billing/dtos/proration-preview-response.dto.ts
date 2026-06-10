import { ApiProperty } from '@nestjs/swagger';
import type {
  BillingProviderId,
  ProrationPreviewResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class ProrationPreviewResponseDto {
  @ApiProperty({ enum: ['paddle', 'yookassa'], example: 'yookassa' })
  provider: BillingProviderId;

  @ApiProperty({ example: 'pro' })
  fromPlanKey: string;

  @ApiProperty({ example: 'business' })
  toPlanKey: string;

  @ApiProperty({ example: 'RUB' })
  currency: string;

  @ApiProperty({
    example: 43000,
    nullable: true,
    description:
      'Refunded unused remainder of the current plan; null when the provider computes the proration itself.'
  })
  creditMinor: number | null;

  @ApiProperty({
    example: 129000,
    nullable: true,
    description:
      'New plan prorated to the period end; null when the provider computes the proration itself.'
  })
  chargeMinor: number | null;

  @ApiProperty({
    example: 86000,
    description:
      'Net immediate effect (charge − credit); negative = net refund.'
  })
  dueNowMinor: number;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<
    WireType<ProrationPreviewResponseDto>,
    ProrationPreviewResponse
  >
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<
    ProrationPreviewResponse,
    WireType<ProrationPreviewResponseDto>
  >
>;
