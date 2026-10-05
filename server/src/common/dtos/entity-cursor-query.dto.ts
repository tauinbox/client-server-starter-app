import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  ALLOWED_FEATURE_FLAG_SORT_COLUMNS,
  ALLOWED_RESOURCE_SORT_COLUMNS,
  ALLOWED_ROLE_SORT_COLUMNS,
  DEFAULT_SORT_BY,
  FEATURE_FLAG_LIST_QUERY,
  RESOURCE_LIST_QUERY,
  ROLE_LIST_QUERY
} from '@app/shared/constants';
import { CursorPaginationQueryDto } from './cursor-pagination-query.dto';
import { ListQueryDto } from './list-query.dto';

/**
 * One cursor query DTO per admin catalog. `sortBy` is whitelisted rather than
 * left open because the keyset helper mints the next cursor from the named
 * property - an unlisted column yields a cursor that cannot resolve a page.
 */
export class RoleCursorQueryDto extends IntersectionType(
  CursorPaginationQueryDto,
  ListQueryDto(ROLE_LIST_QUERY)
) {
  @ApiPropertyOptional({
    default: DEFAULT_SORT_BY,
    enum: ALLOWED_ROLE_SORT_COLUMNS
  })
  @IsOptional()
  @IsIn(ALLOWED_ROLE_SORT_COLUMNS)
  override sortBy: string = DEFAULT_SORT_BY;
}

export class ResourceCursorQueryDto extends IntersectionType(
  CursorPaginationQueryDto,
  ListQueryDto(RESOURCE_LIST_QUERY)
) {
  @ApiPropertyOptional({
    default: DEFAULT_SORT_BY,
    enum: ALLOWED_RESOURCE_SORT_COLUMNS
  })
  @IsOptional()
  @IsIn(ALLOWED_RESOURCE_SORT_COLUMNS)
  override sortBy: string = DEFAULT_SORT_BY;
}

export class FeatureFlagCursorQueryDto extends IntersectionType(
  CursorPaginationQueryDto,
  ListQueryDto(FEATURE_FLAG_LIST_QUERY)
) {
  @ApiPropertyOptional({
    default: DEFAULT_SORT_BY,
    enum: ALLOWED_FEATURE_FLAG_SORT_COLUMNS
  })
  @IsOptional()
  @IsIn(ALLOWED_FEATURE_FLAG_SORT_COLUMNS)
  override sortBy: string = DEFAULT_SORT_BY;
}
