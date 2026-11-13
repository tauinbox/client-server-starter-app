import { ApiProperty } from '@nestjs/swagger';
import type {
  MeteringResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';

export class MeteringResponseDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    nullable: true,
    type: String,
    description:
      'The usage record of the debit. Null when the plan of the customer includes the meter and nothing was recorded.'
  })
  recordId: string | null;

  @ApiProperty({
    example: true,
    description:
      'False when the subscription plan of the customer has the capability of the meter: the use is free.'
  })
  debited: boolean;

  @ApiProperty({
    example: false,
    description:
      'True when the idempotency key was already used with the same body. Nothing is debited again.'
  })
  replayed: boolean;

  @ApiProperty({
    example: 958,
    description: 'The credit balance after this call.'
  })
  balanceAfter: number;
}

type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<MeteringResponseDto>, MeteringResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<MeteringResponse, WireType<MeteringResponseDto>>
>;
