import { ApiProperty } from '@nestjs/swagger';
import type {
  StructuralDiff,
  UsageSummaryResponse,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class UsageSummaryResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  subscriptionId: string;

  @ApiProperty({ example: 'api_calls', nullable: true })
  meterKey: string | null;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  periodStart: Date;

  @ApiProperty({ example: '2023-02-01T00:00:00Z' })
  periodEnd: Date;

  @ApiProperty({ example: 142 })
  totalUnits: number;

  @ApiProperty({ example: 100 })
  includedUnits: number;

  @ApiProperty({ example: 42 })
  billableUnits: number;

  @ApiProperty({ example: 200 })
  unitPriceMinor: number;

  @ApiProperty({ example: 8400 })
  amountMinor: number;

  @ApiProperty({ example: 'RUB' })
  currency: string;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<UsageSummaryResponseDto>, UsageSummaryResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<UsageSummaryResponse, WireType<UsageSummaryResponseDto>>
>;
