import { ApiProperty } from '@nestjs/swagger';
import type {
  EntitlementsResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class EntitlementsResponseDto {
  @ApiProperty({
    example: 'pro',
    description:
      'Plan in force: the active/trialing/past_due subscription plan, or the Free tier.'
  })
  planKey: string;

  @ApiProperty({
    example: ['reports', 'data-export'],
    description:
      'Plan capabilities unioned with active one-time purchase grants.',
    type: [String]
  })
  capabilities: string[];

  @ApiProperty({
    example: { sessions: 10 },
    description: 'Numeric limits carried by the plan in force.',
    additionalProperties: { type: 'number' }
  })
  limits: Record<string, number>;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<EntitlementsResponseDto>, EntitlementsResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<EntitlementsResponse, WireType<EntitlementsResponseDto>>
>;
