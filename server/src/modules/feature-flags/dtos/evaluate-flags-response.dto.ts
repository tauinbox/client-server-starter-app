import { ApiProperty } from '@nestjs/swagger';
import type {
  EvaluatedFeatureFlagsResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class EvaluateFlagsResponseDto {
  @ApiProperty({
    description: 'Map of flag key → evaluated boolean for this caller.',
    example: { 'new-dashboard': false, 'beta-export': true },
    type: 'object',
    additionalProperties: { type: 'boolean' }
  })
  flags: Record<string, boolean>;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  evaluatedAt: string;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<
    WireType<EvaluateFlagsResponseDto>,
    EvaluatedFeatureFlagsResponse
  >
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<
    EvaluatedFeatureFlagsResponse,
    WireType<EvaluateFlagsResponseDto>
  >
>;
