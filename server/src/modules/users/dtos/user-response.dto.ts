import { ApiProperty } from '@nestjs/swagger';
import type {
  StructuralDiff,
  UserResponse,
  WireType,
  _AssertNever
} from '@app/shared/types';
import { RoleResponseDto } from '../../auth/dtos/role-response.dto';

export class UserResponseDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: 'John' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ type: [RoleResponseDto] })
  roles: RoleResponseDto[];

  @ApiProperty({ example: true })
  isEmailVerified: boolean;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  updatedAt: Date;

  @ApiProperty({ example: null, nullable: true })
  deletedAt: Date | null;
}

// Compile-time contract: wire format of UserResponseDto must match UserResponse
// structurally — same keys AND same value types at each key. If either side
// gains a field, loses one, or drifts at a value type (e.g. roles silently
// retyped to string[]), one of these lines fails to compile.
// To fix: update both this DTO and shared/src/types/user.types.ts together.
type _DtoMatchesShared = _AssertNever<
  StructuralDiff<WireType<UserResponseDto>, UserResponse>
>;
type _SharedMatchesDto = _AssertNever<
  StructuralDiff<UserResponse, WireType<UserResponseDto>>
>;
