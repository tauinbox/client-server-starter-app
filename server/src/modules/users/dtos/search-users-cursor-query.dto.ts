import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ALLOWED_USER_SORT_COLUMNS } from '@app/shared/constants';
import { CursorPaginationQueryDto } from '../../../common/dtos';
import { UserFiltersQueryDto } from './user-filters-query.dto';

export class SearchUsersCursorQueryDto extends IntersectionType(
  CursorPaginationQueryDto,
  UserFiltersQueryDto
) {
  @ApiPropertyOptional({
    default: 'createdAt',
    enum: ALLOWED_USER_SORT_COLUMNS
  })
  @IsOptional()
  @IsIn(ALLOWED_USER_SORT_COLUMNS)
  override sortBy: string = 'createdAt';
}
