import { ApiProperty } from '@nestjs/swagger';
import { DATA_REGIONS, type DataRegion } from '@app/shared/constants';
import type {
  RegionStatusResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class RegionStatusResponseDto {
  @ApiProperty({ enum: DATA_REGIONS })
  region: DataRegion;

  @ApiProperty()
  public: boolean;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<RegionStatusResponseDto>, RegionStatusResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<RegionStatusResponse, WireType<RegionStatusResponseDto>>
>;
