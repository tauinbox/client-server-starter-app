import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PermissionCondition } from '@app/shared/types';

export class AssignPermissionsDto {
  @ApiProperty({
    description: 'Array of permission IDs to assign',
    example: ['uuid-1', 'uuid-2']
  })
  @IsArray()
  @IsNotEmpty()
  @IsUUID('4', { each: true })
  permissionIds: string[];

  @ApiPropertyOptional({
    description: 'Optional conditions for the permissions'
  })
  @IsOptional()
  conditions?: PermissionCondition;
}

export class PermissionItemDto {
  @ApiProperty({ description: 'Permission ID', example: 'uuid' })
  @IsUUID('4')
  permissionId: string;

  @ApiPropertyOptional({
    description: 'Optional conditions for this permission'
  })
  @IsOptional()
  conditions?: PermissionCondition | null;
}

export class SetPermissionsDto {
  @ApiProperty({
    description: 'Full desired set of permissions for the role',
    type: [PermissionItemDto]
  })
  @IsArray()
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
