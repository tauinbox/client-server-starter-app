import { ApiProperty } from '@nestjs/swagger';
import type {
  StructuralDiff,
  UsageSummaryResponse,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class UsageSummaryResponseDto {
  @ApiProperty({
    example: '2023-01-01T00:00:00Z',
    description: 'The start of the current calendar month (UTC).'
  })
  periodStart: Date;

  @ApiProperty({
    example: '2023-02-01T00:00:00Z',
    description: 'The start of the next calendar month (UTC).'
  })
  periodEnd: Date;

  @ApiProperty({
    example: 142,
    description: 'The credit units that metered uses took in the period.'
  })
  unitsSpent: number;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<UsageSummaryResponseDto>, UsageSummaryResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<UsageSummaryResponse, WireType<UsageSummaryResponseDto>>
>;
