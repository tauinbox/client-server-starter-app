import { ApiProperty } from '@nestjs/swagger';
import type {
  FeatureFlagResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';
import { FeatureFlagRuleResponseDto } from './feature-flag-rule-response.dto';

export class FeatureFlagResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'new-dashboard' })
  key: string;

  @ApiProperty({ example: 'New dashboard rollout', nullable: true })
  description: string | null;

  @ApiProperty({ example: false })
  enabled: boolean;

  @ApiProperty({ type: [String], example: ['production'] })
  environments: string[];

  @ApiProperty({ example: false })
  public: boolean;

  @ApiProperty({ example: 1 })
  version: number;

  @ApiProperty({ example: null, nullable: true })
  updatedByUserId: string | null;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  updatedAt: Date;

  @ApiProperty({ type: [FeatureFlagRuleResponseDto] })
  rules: FeatureFlagRuleResponseDto[];
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<FeatureFlagResponseDto>, FeatureFlagResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<FeatureFlagResponse, WireType<FeatureFlagResponseDto>>
>;
