import { ApiProperty } from '@nestjs/swagger';
import type {
  AdminUserResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';
import { UserResponseDto } from './user-response.dto';
import { RoleAdminResponseDto } from '../../auth/dtos/role-admin-response.dto';

export class AdminUserResponseDto extends UserResponseDto {
  @ApiProperty({ type: [RoleAdminResponseDto] })
  declare roles: RoleAdminResponseDto[];

  @ApiProperty({ example: null, nullable: true })
  lockedUntil: Date | null;
}

// Compile-time contract: wire format of AdminUserResponseDto must match
// AdminUserResponse structurally in both directions.
type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<AdminUserResponseDto>, AdminUserResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<AdminUserResponse, WireType<AdminUserResponseDto>>
>;
