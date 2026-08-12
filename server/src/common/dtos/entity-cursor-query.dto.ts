import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  ALLOWED_ACTION_SORT_COLUMNS,
  ALLOWED_FEATURE_FLAG_SORT_COLUMNS,
  ALLOWED_RESOURCE_SORT_COLUMNS,
  ALLOWED_ROLE_SORT_COLUMNS,
  DEFAULT_SORT_BY
} from '@app/shared/constants';
import { CursorPaginationQueryDto } from './cursor-pagination-query.dto';

/**
 * One cursor query DTO per admin catalog. `sortBy` is whitelisted rather than
 * left open because the keyset helper mints the next cursor from the named
 * property - an unlisted column yields a cursor that cannot resolve a page.
 */
export class RoleCursorQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_SORT_BY,
    enum: ALLOWED_ROLE_SORT_COLUMNS
  })
  @IsOptional()
  @IsIn(ALLOWED_ROLE_SORT_COLUMNS)
  override sortBy: string = DEFAULT_SORT_BY;
}

export class ResourceCursorQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_SORT_BY,
    enum: ALLOWED_RESOURCE_SORT_COLUMNS
  })
  @IsOptional()
  @IsIn(ALLOWED_RESOURCE_SORT_COLUMNS)
  override sortBy: string = DEFAULT_SORT_BY;
}

export class ActionCursorQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_SORT_BY,
    enum: ALLOWED_ACTION_SORT_COLUMNS
  })
  @IsOptional()
  @IsIn(ALLOWED_ACTION_SORT_COLUMNS)
  override sortBy: string = DEFAULT_SORT_BY;
}

export class FeatureFlagCursorQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_SORT_BY,
    enum: ALLOWED_FEATURE_FLAG_SORT_COLUMNS
  })
  @IsOptional()
  @IsIn(ALLOWED_FEATURE_FLAG_SORT_COLUMNS)
  override sortBy: string = DEFAULT_SORT_BY;
}
