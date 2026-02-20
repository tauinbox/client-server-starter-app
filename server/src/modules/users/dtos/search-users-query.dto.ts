import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { ALLOWED_USER_SORT_COLUMNS } from '@app/shared/constants/user.constants';
import { PaginationQueryDto } from '../../../common/dtos';

export class SearchUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    default: 'createdAt',
    enum: ALLOWED_USER_SORT_COLUMNS
  })
  @IsOptional()
  @IsIn(ALLOWED_USER_SORT_COLUMNS)
  override sortBy: string = 'createdAt';

  @ApiPropertyOptional({ description: 'Filter by email (partial match)' })
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ description: 'Filter by first name (partial match)' })
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional({ description: 'Filter by last name (partial match)' })
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional({ description: 'Filter by admin status' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  isAdmin?: boolean;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  isActive?: boolean;
}
