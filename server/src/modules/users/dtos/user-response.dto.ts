import { ApiProperty } from '@nestjs/swagger';
import type { UserResponse, WireType, _AssertNever } from '@app/shared/types';

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

  @ApiProperty({ example: ['user'] })
  roles: string[];

  @ApiProperty({ example: true })
  isEmailVerified: boolean;

  @ApiProperty({ example: 0 })
  failedLoginAttempts: number;

  @ApiProperty({ example: null, nullable: true })
  lockedUntil: Date | null;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  createdAt: Date;

  @ApiProperty({ example: '2023-01-01T00:00:00Z' })
  updatedAt: Date;

  @ApiProperty({ example: null, nullable: true })
  deletedAt: Date | null;
}

// Compile-time contract: wire format of UserResponseDto must exactly match UserResponse.
// If either side gains or loses a field, one of these lines will fail to compile.
// To fix: update both this DTO and shared/src/types/user.types.ts together.
type _DtoHasAllResponseFields = _AssertNever<
  Exclude<keyof UserResponse, keyof WireType<UserResponseDto>>
>;
type _ResponseHasAllDtoFields = _AssertNever<
  Exclude<keyof WireType<UserResponseDto>, keyof UserResponse>
>;
