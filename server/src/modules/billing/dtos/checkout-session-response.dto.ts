import { ApiProperty } from '@nestjs/swagger';
import type {
  BillingProviderId,
  CheckoutSessionResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class CheckoutSessionResponseDto {
  @ApiProperty({ enum: ['paddle', 'yookassa'], example: 'yookassa' })
  provider: BillingProviderId;

  @ApiProperty({ example: 'https://yoomoney.ru/checkout/payments/...' })
  url: string;

  @ApiProperty({ example: '2c8a...' })
  sessionRef: string;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<CheckoutSessionResponseDto>, CheckoutSessionResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<CheckoutSessionResponse, WireType<CheckoutSessionResponseDto>>
>;
