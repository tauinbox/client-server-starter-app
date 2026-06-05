import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class CheckoutRequestDto {
  @ApiProperty({
    description: 'Key of the plan to subscribe to (e.g. "pro").',
    example: 'pro'
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  planKey: string;
}
