import { IsInt, IsOptional, IsPositive } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RefundInvoiceRequestDto {
  @ApiPropertyOptional({
    description:
      'Partial refund amount in minor units. Omit for a full refund of the invoice total.',
    example: 500
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  amountMinor?: number;
}
