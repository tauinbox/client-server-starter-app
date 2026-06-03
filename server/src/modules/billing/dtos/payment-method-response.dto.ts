import { ApiProperty } from '@nestjs/swagger';
import type {
  BillingProviderId,
  PaymentMethodResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class PaymentMethodResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  customerId: string;

  @ApiProperty({ enum: ['paddle', 'yookassa'], example: 'paddle' })
  provider: BillingProviderId;

  @ApiProperty({ example: 'visa' })
  brand: string;

  @ApiProperty({ example: '4242' })
  last4: string;

  @ApiProperty({ example: true })
  isDefault: boolean;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  updatedAt: Date;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<PaymentMethodResponseDto>, PaymentMethodResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<PaymentMethodResponse, WireType<PaymentMethodResponseDto>>
>;
