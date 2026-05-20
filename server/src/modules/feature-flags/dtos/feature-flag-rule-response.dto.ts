import { ApiProperty } from '@nestjs/swagger';
import type {
  FeatureFlagRulePayload,
  FeatureFlagRuleEffect,
  FeatureFlagRuleResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class FeatureFlagRuleResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  flagId: string;

  @ApiProperty({ enum: ['include', 'exclude'] })
  effect: FeatureFlagRuleEffect;

  @ApiProperty({ description: 'Rule payload (discriminated on type).' })
  payload: FeatureFlagRulePayload;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  updatedAt: Date;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<FeatureFlagRuleResponseDto>, FeatureFlagRuleResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<FeatureFlagRuleResponse, WireType<FeatureFlagRuleResponseDto>>
>;
