import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { RoleService } from '../services/role.service';
import { CreateRoleDto } from '../dtos/create-role.dto';
import { UpdateRoleDto } from '../dtos/update-role.dto';
import {
  AssignPermissionsDto,
  AssignRoleDto
} from '../dtos/assign-permissions.dto';
import { Authorize } from '../decorators/authorize.decorator';
import { PERMISSIONS } from '@app/shared/constants';

@ApiTags('Roles API')
@Controller({
  path: 'roles',
  version: '1'
})
export class RolesController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @Authorize(PERMISSIONS.ROLES_READ)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all roles' })
  @ApiOkResponse({ description: 'List of roles' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  findAll() {
    return this.roleService.findAll();
  }

  @Get('permissions')
  @Authorize(PERMISSIONS.ROLES_READ)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all available permissions' })
  @ApiOkResponse({ description: 'List of permissions' })
  findAllPermissions() {
    return this.roleService.findAllPermissions();
  }

  @Get(':id')
  @Authorize(PERMISSIONS.ROLES_READ)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a role by ID' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiOkResponse({ description: 'The role' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  findOne(@Param('id') id: string) {
    return this.roleService.findOne(id);
  }

  @Post()
  @Authorize(PERMISSIONS.ROLES_CREATE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new role' })
  @ApiBody({ type: CreateRoleDto })
  @ApiCreatedResponse({ description: 'Role created' })
  create(@Body() createRoleDto: CreateRoleDto) {
    return this.roleService.create(createRoleDto);
  }

  @Patch(':id')
  @Authorize(PERMISSIONS.ROLES_UPDATE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiBody({ type: UpdateRoleDto })
  @ApiOkResponse({ description: 'Role updated' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    return this.roleService.update(id, updateRoleDto);
  }

  @Delete(':id')
  @Authorize(PERMISSIONS.ROLES_DELETE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiOkResponse({ description: 'Role deleted' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  remove(@Param('id') id: string) {
    return this.roleService.delete(id);
  }

  @Post(':id/permissions')
  @Authorize(PERMISSIONS.ROLES_UPDATE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign permissions to a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiBody({ type: AssignPermissionsDto })
  @ApiOkResponse({ description: 'Permissions assigned' })
  assignPermissions(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto
  ) {
    return this.roleService.assignPermissionsToRole(
      id,
      dto.permissionIds,
      dto.conditions
    );
  }

  @Delete(':id/permissions/:permissionId')
  @Authorize(PERMISSIONS.ROLES_UPDATE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a permission from a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiParam({ name: 'permissionId', description: 'The permission ID' })
  @ApiOkResponse({ description: 'Permission removed' })
  removePermission(
    @Param('id') id: string,
    @Param('permissionId') permissionId: string
  ) {
    return this.roleService.removePermissionFromRole(id, permissionId);
  }

  @Post('assign/:userId')
  @Authorize(PERMISSIONS.ROLES_ASSIGN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign a role to a user' })
  @ApiParam({ name: 'userId', description: 'The user ID' })
  @ApiBody({ type: AssignRoleDto })
  @ApiOkResponse({ description: 'Role assigned' })
  assignRole(@Param('userId') userId: string, @Body() dto: AssignRoleDto) {
    return this.roleService.assignRoleToUser(userId, dto.roleId);
  }

  @Delete('assign/:userId/:roleId')
  @Authorize(PERMISSIONS.ROLES_ASSIGN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a role from a user' })
  @ApiParam({ name: 'userId', description: 'The user ID' })
  @ApiParam({ name: 'roleId', description: 'The role ID' })
  @ApiOkResponse({ description: 'Role removed' })
  removeRole(@Param('userId') userId: string, @Param('roleId') roleId: string) {
    return this.roleService.removeRoleFromUser(userId, roleId);
  }
}
