import { ApiProperty } from '@nestjs/swagger';
import type {
  AdminUserResponse,
  WireType,
  _AssertNever
} from '@app/shared/types';
import { UserResponseDto } from './user-response.dto';

export class AdminUserResponseDto extends UserResponseDto {
  @ApiProperty({ example: null, nullable: true })
  lockedUntil: Date | null;
}

// Compile-time contract: wire format of AdminUserResponseDto must exactly match AdminUserResponse.
type _DtoHasAllAdminResponseFields = _AssertNever<
  Exclude<keyof AdminUserResponse, keyof WireType<AdminUserResponseDto>>
>;
type _AdminResponseHasAllDtoFields = _AssertNever<
  Exclude<keyof WireType<AdminUserResponseDto>, keyof AdminUserResponse>
>;
