import { ApiProperty } from '@nestjs/swagger';
import type {
  RoleAdminResponse,
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

// Compile-time contract: wire format of RoleAdminResponseDto must exactly match RoleAdminResponse.
type _DtoHasAllResponseFields = _AssertNever<
  Exclude<keyof RoleAdminResponse, keyof WireType<RoleAdminResponseDto>>
>;
type _ResponseHasAllDtoFields = _AssertNever<
  Exclude<keyof WireType<RoleAdminResponseDto>, keyof RoleAdminResponse>
>;
