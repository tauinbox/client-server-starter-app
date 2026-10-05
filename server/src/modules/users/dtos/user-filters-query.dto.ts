import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { MAX_LIST_FILTER_LENGTH, USER_LIST_QUERY } from '@app/shared/constants';
import { ListQueryDto } from '../../../common/dtos';
import { toOptionalBoolean } from '../../../common/utils/query-transforms';

/**
 * Filter half of the user list/search query, shared by both cursor routes via
 * `IntersectionType` so the two cannot drift apart. The search and the column
 * filters come from the shared list definition; `role` (a join) and
 * `includeDeleted` (a scope switch) are not column filters and stay here.
 */
export class UserFiltersQueryDto extends ListQueryDto(USER_LIST_QUERY) {
  @ApiPropertyOptional({
    maxLength: MAX_LIST_FILTER_LENGTH,
    description:
      'Filter by role name (users having a role with this exact name)'
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LIST_FILTER_LENGTH)
  role?: string;

  @ApiPropertyOptional({
    description: 'Include soft-deleted users (admin only)'
  })
  @IsOptional()
  @IsBoolean()
  @Transform(toOptionalBoolean)
  includeDeleted?: boolean;
}
