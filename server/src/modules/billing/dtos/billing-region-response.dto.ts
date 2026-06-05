import { ApiProperty } from '@nestjs/swagger';
import type {
  BillingProviderId,
  BillingRegion,
  BillingRegionResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class BillingRegionResponseDto {
  @ApiProperty({ enum: ['auto', 'ru', 'world'], example: 'auto' })
  region: BillingRegion;

  @ApiProperty({ enum: ['paddle', 'yookassa'], example: 'paddle' })
  detectedProvider: BillingProviderId;

  @ApiProperty({ enum: ['paddle', 'yookassa'], example: 'paddle' })
  effectiveProvider: BillingProviderId;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<BillingRegionResponseDto>, BillingRegionResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<BillingRegionResponse, WireType<BillingRegionResponseDto>>
>;
