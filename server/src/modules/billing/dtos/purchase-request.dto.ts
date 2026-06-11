import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class PurchaseRequestDto {
  @ApiProperty({
    description: 'Key of the product to purchase (e.g. "report-pack").',
    example: 'report-pack'
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  productKey: string;

  @ApiPropertyOptional({
    description:
      'Amount in minor units for a custom-amount product (validated against the product bounds). Ignored for fixed-price products — the server price is authoritative.',
    example: 150000
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountMinor?: number;

  @ApiPropertyOptional({
    description:
      'Optional buyer note shown on the receipt of a custom-amount purchase.',
    example: 'Keep up the good work'
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value
  )
  @IsString()
  @MaxLength(128)
  description?: string;
}
