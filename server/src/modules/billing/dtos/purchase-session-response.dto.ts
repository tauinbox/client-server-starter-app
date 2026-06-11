import { ApiProperty } from '@nestjs/swagger';
import type {
  BillingProviderId,
  PurchaseSessionResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class PurchaseSessionResponseDto {
  @ApiProperty({ enum: ['paddle', 'yookassa'], example: 'yookassa' })
  provider: BillingProviderId;

  @ApiProperty({
    nullable: true,
    example: 'https://yoomoney.ru/checkout/payments/...'
  })
  url: string | null;

  @ApiProperty({ example: 'txn_01h...' })
  sessionRef: string;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<PurchaseSessionResponseDto>, PurchaseSessionResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<PurchaseSessionResponse, WireType<PurchaseSessionResponseDto>>
>;
