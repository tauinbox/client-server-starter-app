import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';

/**
 * Metering ingest payload (design §3, §5). The usage record is attached to the
 * customer's currently-active subscription server-side, so the caller never
 * supplies a subscription id. `idempotencyKey` is the dedup anchor — replaying
 * the same key returns the original record instead of double-counting.
 */
export class RecordUsageRequestDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsUUID()
  customerId: string;

  @ApiProperty({ example: 'api_calls' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  meterKey: string;

  @ApiProperty({ example: 42, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  quantity: number;

  @ApiPropertyOptional({
    description: 'When the usage occurred (ISO 8601). Defaults to now.',
    example: '2023-01-01T00:00:00.000Z'
  })
  @IsOptional()
  @IsISO8601()
  occurredAt?: string;

  @ApiProperty({ example: 'evt-2023-01-01-42' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value
  )
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  idempotencyKey: string;
}
