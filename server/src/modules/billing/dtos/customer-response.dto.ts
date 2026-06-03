import { ApiProperty } from '@nestjs/swagger';
import type {
  BillingProviderId,
  CustomerResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class CustomerResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  userId: string;

  @ApiProperty({ enum: ['paddle', 'yookassa'], example: 'paddle' })
  provider: BillingProviderId;

  @ApiProperty({ enum: ['paddle', 'yookassa'], nullable: true, example: null })
  providerOverride: BillingProviderId | null;

  @ApiProperty({ example: 'US' })
  country: string;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ nullable: true, example: null })
  defaultPaymentMethodId: string | null;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  updatedAt: Date;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<CustomerResponseDto>, CustomerResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<CustomerResponse, WireType<CustomerResponseDto>>
>;
