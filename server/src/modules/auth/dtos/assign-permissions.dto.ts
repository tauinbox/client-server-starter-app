import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUniqueWithin } from '../../../common/validators/array-unique-within.validator';
import { PermissionConditionDto } from './permission-condition.dto';

const MAX_PERMISSION_ITEMS = 500;

export class AssignPermissionsDto {
  @ApiProperty({
    description: 'Array of permission IDs to assign',
    example: ['uuid-1', 'uuid-2']
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_PERMISSION_ITEMS)
  @ArrayUniqueWithin(MAX_PERMISSION_ITEMS)
  @IsUUID('4', { each: true })
  permissionIds: string[];

  @ApiPropertyOptional({
    description: 'Optional conditions for the permissions'
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PermissionConditionDto)
  conditions?: PermissionConditionDto;
}

export class PermissionItemDto {
  @ApiProperty({ description: 'Permission ID', example: 'uuid' })
  @IsUUID('4')
  permissionId: string;

  @ApiPropertyOptional({
    description: 'Optional conditions for this permission'
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PermissionConditionDto)
  conditions?: PermissionConditionDto | null;
}

// An item that is not an object, or that has no permissionId, gets its own
// key, so that only a repeated permissionId fails the uniqueness check.
function permissionIdOf(item: unknown): unknown {
  return typeof item === 'object' && item !== null && 'permissionId' in item
    ? item.permissionId
    : Symbol();
}

export class SetPermissionsDto {
  @ApiProperty({
    description: 'Full desired set of permissions for the role',
    type: [PermissionItemDto]
  })
  @IsArray()
  @ArrayMaxSize(MAX_PERMISSION_ITEMS)
  @ArrayUniqueWithin(MAX_PERMISSION_ITEMS, permissionIdOf)
  @IsObject({ each: true })
  @ValidateNested({ each: true })
  @Type(() => PermissionItemDto)
  items: PermissionItemDto[];
}

export class AssignRoleDto {
  @ApiProperty({
    description: 'The role ID to assign',
    example: 'uuid'
  })
  @IsNotEmpty()
  @IsString()
  @IsUUID('4')
  roleId: string;
}
