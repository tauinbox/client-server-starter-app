import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request
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
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { JwtAuthRequest } from '../types/auth.request';

@ApiTags('Roles API')
@Controller({
  path: 'roles',
  version: '1'
})
export class RolesController {
  constructor(
    private readonly roleService: RoleService,
    private readonly auditService: AuditService
  ) {}

  @Get()
  @Authorize(['read', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all roles' })
  @ApiOkResponse({ description: 'List of roles' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  findAll() {
    return this.roleService.findAll();
  }

  @Get('permissions')
  @Authorize(['read', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all available permissions' })
  @ApiOkResponse({ description: 'List of permissions' })
  findAllPermissions() {
    return this.roleService.findAllPermissions();
  }

  @Get(':id')
  @Authorize(['read', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a role by ID' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiOkResponse({ description: 'The role' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  findOne(@Param('id') id: string) {
    return this.roleService.findOne(id);
  }

  @Post()
  @Authorize(['create', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new role' })
  @ApiBody({ type: CreateRoleDto })
  @ApiCreatedResponse({ description: 'Role created' })
  async create(
    @Body() createRoleDto: CreateRoleDto,
    @Request() req: JwtAuthRequest
  ) {
    const role = await this.roleService.create(createRoleDto);
    await this.auditService.log({
      action: AuditAction.ROLE_CREATE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: (role as { id: string }).id,
      targetType: 'Role',
      details: { name: createRoleDto.name },
      context: extractAuditContext(req)
    });
    return role;
  }

  @Patch(':id')
  @Authorize(['update', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiBody({ type: UpdateRoleDto })
  @ApiOkResponse({ description: 'Role updated' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async update(
    @Param('id') id: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @Request() req: JwtAuthRequest
  ) {
    const result = await this.roleService.update(id, updateRoleDto);
    await this.auditService.log({
      action: AuditAction.ROLE_UPDATE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'Role',
      details: { changedFields: Object.keys(updateRoleDto) },
      context: extractAuditContext(req)
    });
    return result;
  }

  @Delete(':id')
  @Authorize(['delete', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiOkResponse({ description: 'Role deleted' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async remove(@Param('id') id: string, @Request() req: JwtAuthRequest) {
    const result = await this.roleService.delete(id);
    await this.auditService.log({
      action: AuditAction.ROLE_DELETE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'Role',
      context: extractAuditContext(req)
    });
    return result;
  }

  @Post(':id/permissions')
  @Authorize(['update', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign permissions to a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiBody({ type: AssignPermissionsDto })
  @ApiOkResponse({ description: 'Permissions assigned' })
  async assignPermissions(
    @Param('id') id: string,
    @Body() dto: AssignPermissionsDto,
    @Request() req: JwtAuthRequest
  ) {
    const result = await this.roleService.assignPermissionsToRole(
      id,
      dto.permissionIds,
      dto.conditions
    );
    await this.auditService.log({
      action: AuditAction.PERMISSION_ASSIGN,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'Role',
      details: { permissionIds: dto.permissionIds },
      context: extractAuditContext(req)
    });
    return result;
  }

  @Delete(':id/permissions/:permissionId')
  @Authorize(['update', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a permission from a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiParam({ name: 'permissionId', description: 'The permission ID' })
  @ApiOkResponse({ description: 'Permission removed' })
  async removePermission(
    @Param('id') id: string,
    @Param('permissionId') permissionId: string,
    @Request() req: JwtAuthRequest
  ) {
    const result = await this.roleService.removePermissionFromRole(
      id,
      permissionId
    );
    await this.auditService.log({
      action: AuditAction.PERMISSION_UNASSIGN,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'Role',
      details: { permissionId },
      context: extractAuditContext(req)
    });
    return result;
  }

  @Post('assign/:userId')
  @Authorize(['assign', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign a role to a user' })
  @ApiParam({ name: 'userId', description: 'The user ID' })
  @ApiBody({ type: AssignRoleDto })
  @ApiOkResponse({ description: 'Role assigned' })
  async assignRole(
    @Param('userId') userId: string,
    @Body() dto: AssignRoleDto,
    @Request() req: JwtAuthRequest
  ) {
    const result = await this.roleService.assignRoleToUser(userId, dto.roleId);
    await this.auditService.log({
      action: AuditAction.ROLE_ASSIGN,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: userId,
      targetType: 'User',
      details: { roleId: dto.roleId },
      context: extractAuditContext(req)
    });
    return result;
  }

  @Delete('assign/:userId/:roleId')
  @Authorize(['assign', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a role from a user' })
  @ApiParam({ name: 'userId', description: 'The user ID' })
  @ApiParam({ name: 'roleId', description: 'The role ID' })
  @ApiOkResponse({ description: 'Role removed' })
  async removeRole(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @Request() req: JwtAuthRequest
  ) {
    const result = await this.roleService.removeRoleFromUser(userId, roleId);
    await this.auditService.log({
      action: AuditAction.ROLE_UNASSIGN,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: userId,
      targetType: 'User',
      details: { roleId },
      context: extractAuditContext(req)
    });
    return result;
  }
}
