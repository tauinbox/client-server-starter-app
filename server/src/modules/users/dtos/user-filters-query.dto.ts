import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength
} from 'class-validator';
import { MAX_PAGE_SIZE, MAX_USER_FILTER_LENGTH } from '@app/shared/constants';

/**
 * Recognises the two spellings a query string can carry for a boolean and
 * leaves anything else untouched, so `@IsBoolean()` rejects it with a 400
 * instead of the filter being silently dropped. An absent or empty parameter
 * (`?isActive=`) stays `undefined` - the same "filter not set" reading the
 * string filters give an empty value.
 */
function toOptionalBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  if (value === '' || value === null || value === undefined) return undefined;
  return value;
}

/**
 * An empty `?ids=` becomes `['']` and fails the UUID check, so it can never
 * read as "no id filter" and widen the result to every user.
 */
function toIdList({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.split(',') : value;
}

/**
 * Filter half of the user list/search query, shared by the offset- and
 * cursor-paginated DTOs via `IntersectionType` so the two cannot drift apart.
 */
export class UserFiltersQueryDto {
  @ApiPropertyOptional({
    maxLength: MAX_USER_FILTER_LENGTH,
    description:
      'Unified substring search across id, email, firstName, lastName (case-insensitive). Combined with the other filters via AND.'
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_USER_FILTER_LENGTH)
  q?: string;

  @ApiPropertyOptional({
    maxLength: MAX_USER_FILTER_LENGTH,
    description: 'Filter by email (partial match)'
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_USER_FILTER_LENGTH)
  email?: string;

  @ApiPropertyOptional({
    maxLength: MAX_USER_FILTER_LENGTH,
    description: 'Filter by first name (partial match)'
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_USER_FILTER_LENGTH)
  firstName?: string;

  @ApiPropertyOptional({
    maxLength: MAX_USER_FILTER_LENGTH,
    description: 'Filter by last name (partial match)'
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_USER_FILTER_LENGTH)
  lastName?: string;

  @ApiPropertyOptional({
    maxLength: MAX_USER_FILTER_LENGTH,
    description:
      'Filter by role name (users having a role with this exact name)'
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_USER_FILTER_LENGTH)
  role?: string;

  @ApiPropertyOptional({
    type: String,
    description: `Comma-separated user ids (at most ${MAX_PAGE_SIZE}); returns only these users`
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_PAGE_SIZE)
  @IsUUID('all', { each: true })
  @Transform(toIdList)
  ids?: string[];

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @IsBoolean()
  @Transform(toOptionalBoolean)
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Include soft-deleted users (admin only)'
  })
  @IsOptional()
  @IsBoolean()
  @Transform(toOptionalBoolean)
  includeDeleted?: boolean;
}
