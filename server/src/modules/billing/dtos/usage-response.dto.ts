import { ApiProperty } from '@nestjs/swagger';
import type {
  StructuralDiff,
  UsageResponse,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class UsageResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  customerId: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  subscriptionId: string;

  @ApiProperty({ example: 'api_calls' })
  meterKey: string;

  @ApiProperty({ example: 42 })
  quantity: number;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  occurredAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  recordedAt: Date;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<UsageResponseDto>, UsageResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<UsageResponse, WireType<UsageResponseDto>>
>;
