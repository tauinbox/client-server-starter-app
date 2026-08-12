import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  ALLOWED_INVOICE_SORT_COLUMNS,
  ALLOWED_SUBSCRIPTION_SORT_COLUMNS,
  DEFAULT_SORT_BY
} from '@app/shared/constants';
import { CursorPaginationQueryDto } from '../../../common/dtos';

/**
 * `sortBy` is whitelisted per entity rather than left open: the keyset helper
 * reads the cursor value off the named property, so an unlisted column would
 * mint a cursor that cannot resolve the next page.
 */
export class InvoiceCursorQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_SORT_BY,
    enum: ALLOWED_INVOICE_SORT_COLUMNS
  })
  @IsOptional()
  @IsIn(ALLOWED_INVOICE_SORT_COLUMNS)
  override sortBy: string = DEFAULT_SORT_BY;
}

export class SubscriptionCursorQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_SORT_BY,
    enum: ALLOWED_SUBSCRIPTION_SORT_COLUMNS
  })
  @IsOptional()
  @IsIn(ALLOWED_SUBSCRIPTION_SORT_COLUMNS)
  override sortBy: string = DEFAULT_SORT_BY;
}
