import { ApiProperty } from '@nestjs/swagger';
import type {
  CreditBalanceResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class CreditBalanceResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  customerId: string;

  @ApiProperty({
    example: 1240,
    description: 'Prepaid credit units; negative after a refund clawback.'
  })
  balanceUnits: number;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  updatedAt: Date;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<CreditBalanceResponseDto>, CreditBalanceResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<CreditBalanceResponse, WireType<CreditBalanceResponseDto>>
>;
