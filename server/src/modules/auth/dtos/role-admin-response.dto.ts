import { ApiProperty } from '@nestjs/swagger';
import type {
  RoleAdminResponse,
  StructuralDiff,
  WireType,
  _AssertNever
} from '@app/shared/types';
import { RoleResponseDto } from './role-response.dto';

export class RoleAdminResponseDto extends RoleResponseDto {
  @ApiProperty({ example: true })
  isSystem: boolean;

  @ApiProperty({ example: false })
  isSuper: boolean;
}

// Compile-time contract: wire format of RoleAdminResponseDto must match
// RoleAdminResponse structurally in both directions.
type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<RoleAdminResponseDto>, RoleAdminResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<RoleAdminResponse, WireType<RoleAdminResponseDto>>
>;
