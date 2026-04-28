import { ApiProperty } from '@nestjs/swagger';
import type { RoleResponse, WireType, _AssertNever } from '@app/shared/types';

export class RoleResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'admin' })
  name: string;

  @ApiProperty({ example: 'Administrator role', nullable: true })
  description: string | null;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  updatedAt: Date;
}

// Compile-time contract: wire format of RoleResponseDto must exactly match RoleResponse.
type _DtoHasAllResponseFields = _AssertNever<
  Exclude<keyof RoleResponse, keyof WireType<RoleResponseDto>>
>;
type _ResponseHasAllDtoFields = _AssertNever<
  Exclude<keyof WireType<RoleResponseDto>, keyof RoleResponse>
>;
