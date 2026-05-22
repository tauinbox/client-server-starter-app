import { ApiProperty } from '@nestjs/swagger';
import type {
  FeatureFlagPreviewMatchedRule,
  FeatureFlagPreviewReason,
  FeatureFlagPreviewResult,
  FeatureFlagRuleEffect,
  FeatureFlagRuleType,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class PreviewFlagMatchedRuleDto {
  @ApiProperty({ example: 0 })
  index: number;

  @ApiProperty({
    enum: ['user', 'role', 'percentage', 'attribute'],
    example: 'role'
  })
  type: FeatureFlagRuleType;

  @ApiProperty({ enum: ['include', 'exclude'], example: 'include' })
  effect: FeatureFlagRuleEffect;
}

export class PreviewFlagResponseDto {
  @ApiProperty({ example: true })
  result: boolean;

  @ApiProperty({
    enum: [
      'disabled',
      'env-mismatch',
      'excluded',
      'included-by-rule',
      'no-rules-default-on'
    ],
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
