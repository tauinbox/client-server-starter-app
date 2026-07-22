import { IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RefundInvoiceRequestDto {
  @ApiPropertyOptional({
    description:
      'Partial refund amount in minor units. Omit for a full refund of the invoice total.',
    example: 500,
    minimum: 1
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountMinor?: number;
}
