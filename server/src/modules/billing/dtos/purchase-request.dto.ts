import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { propertyIsDefined } from '../../../common/validators/property-is-defined';

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
  // Defined-only, not @IsOptional(): the amount is read as a number, so an
  // explicit null has to fail the bounds check rather than be skipped by it.
  @ValidateIf(propertyIsDefined)
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
