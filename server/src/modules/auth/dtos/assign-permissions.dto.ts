import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID
} from 'class-validator';
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
