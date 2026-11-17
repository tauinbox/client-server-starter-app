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
import { permissionIdOf } from '@app/shared/utils/permission-id';
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
