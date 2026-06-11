import { ApiProperty } from '@nestjs/swagger';
import type {
  CustomerGrantResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class CustomerGrantResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  customerId: string;

  @ApiProperty({ example: 'pro-badge' })
  entitlement: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  sourceInvoiceId: string;

  @ApiProperty({ nullable: true, example: null })
  expiresAt: Date | null;

  @ApiProperty({ nullable: true, example: null })
  revokedAt: Date | null;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  createdAt: Date;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<CustomerGrantResponseDto>, CustomerGrantResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<CustomerGrantResponse, WireType<CustomerGrantResponseDto>>
>;
