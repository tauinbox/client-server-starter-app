import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class ChangeSubscriptionRequestDto {
  @ApiProperty({
    description:
      'Key of the plan to switch to (tier and/or billing mode — each plan fixes both).',
    example: 'business'
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  planKey: string;
}
