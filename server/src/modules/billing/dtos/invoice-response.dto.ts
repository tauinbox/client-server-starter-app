import { ApiProperty } from '@nestjs/swagger';
import type {
  BillingMode,
  BillingProviderId,
  InvoiceKind,
  InvoiceResponse,
  InvoiceStatus,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class InvoiceResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  customerId: string;

  @ApiProperty({ nullable: true, example: null })
  subscriptionId: string | null;

  @ApiProperty({ enum: ['paddle', 'yookassa'], example: 'paddle' })
  provider: BillingProviderId;

  @ApiProperty({ example: 'txn_01h...' })
  providerInvoiceRef: string;

  @ApiProperty({ example: 1200 })
  amountMinor: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    enum: ['pending', 'paid', 'failed', 'refunded'],
    example: 'paid'
  })
  status: InvoiceStatus;

  @ApiProperty({ enum: ['fixed', 'usage'], example: 'fixed' })
  billingMode: BillingMode;

  @ApiProperty({
    enum: ['subscription', 'one_time'],
    example: 'subscription'
  })
  kind: InvoiceKind;

  @ApiProperty({ nullable: true, example: null })
  productId: string | null;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  periodStart: Date;

  @ApiProperty({ example: '2023-02-01T00:00:00Z' })
  periodEnd: Date;

  @ApiProperty({ nullable: true, example: '2023-01-01T00:00:00Z' })
  paidAt: Date | null;

  @ApiProperty({ nullable: true, example: null })
  receiptRef: string | null;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  updatedAt: Date;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<InvoiceResponseDto>, InvoiceResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<InvoiceResponse, WireType<InvoiceResponseDto>>
>;
