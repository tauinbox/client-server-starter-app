import { ApiProperty } from '@nestjs/swagger';
import {
  FEATURE_FLAG_PREVIEW_REASONS,
  FEATURE_FLAG_RULE_EFFECTS,
  FEATURE_FLAG_RULE_TYPES,
  type FeatureFlagPreviewReason,
  type FeatureFlagRuleEffect,
  type FeatureFlagRuleType
} from '@app/shared/constants';
import type {
  FeatureFlagPreviewMatchedRule,
  FeatureFlagPreviewResult,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class PreviewFlagMatchedRuleDto {
  @ApiProperty({ example: 0 })
  index: number;

  @ApiProperty({ enum: FEATURE_FLAG_RULE_TYPES, example: 'role' })
  type: FeatureFlagRuleType;

  @ApiProperty({ enum: FEATURE_FLAG_RULE_EFFECTS, example: 'include' })
  effect: FeatureFlagRuleEffect;
}

export class PreviewFlagResponseDto {
  @ApiProperty({ example: true })
  result: boolean;

  @ApiProperty({
    enum: FEATURE_FLAG_PREVIEW_REASONS,
    example: 'included-by-rule'
  })
  reason: FeatureFlagPreviewReason;

  @ApiProperty({ type: PreviewFlagMatchedRuleDto, nullable: true })
  matchedRule: FeatureFlagPreviewMatchedRule | null;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<PreviewFlagResponseDto>, FeatureFlagPreviewResult>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<FeatureFlagPreviewResult, WireType<PreviewFlagResponseDto>>
>;
