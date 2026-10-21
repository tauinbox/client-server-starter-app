import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  SerializeOptions
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
import { RoleCursorQueryDto } from '../../../common/dtos';
import { RoleService } from '../services/role.service';
import { CreateRoleDto } from '../dtos/create-role.dto';
import { UpdateRoleDto } from '../dtos/update-role.dto';
import {
  AssignPermissionsDto,
  AssignRoleDto,
  SetPermissionsDto
} from '../dtos/assign-permissions.dto';
import { Authorize } from '../decorators/authorize.decorator';
import { CurrentAbility } from '../decorators/current-ability.decorator';
import { RegisterResource } from '../decorators/register-resource.decorator';
import type { AppAbility } from '../casl/app-ability';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { changedFields } from '@app/shared/utils/changed-fields';
import type { AuditLogParams } from '../../audit/audit.service';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRoleChangedEvent } from '../events/user-role-changed.event';
import { UserUpdatedEvent } from '../../users/events/user-updated.event';
import type { JwtAuthRequest } from '../types/auth.request';

@ApiTags('Roles API')
@Controller({
  path: 'roles',
  version: '1'
})
@RegisterResource({
  name: 'roles',
  subject: 'Role',
  displayName: 'Roles',
  description: 'Role management',
  actions: ['create', 'read', 'update', 'delete', 'assign'],
  conditionalActions: ['create', 'update', 'delete', 'assign']
})
@SerializeOptions({ groups: ['privileged'] })
export class RolesController {
  constructor(
    private readonly roleService: RoleService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  private auditRow(
    req: JwtAuthRequest,
    row: Pick<AuditLogParams, 'action' | 'targetType' | 'targetId' | 'details'>
  ): AuditLogParams {
    return {
      ...row,
      actorId: req.user?.userId ?? null,
      actorEmail: req.user?.email ?? null,
      context: extractAuditContext(req)
    };
  }

  // No `previous` record: the user list check reads the row without its
  // roles, so a role change cannot move the user out of a viewer's scope.
  private async emitUserRolesChanged(userId: string): Promise<void> {
    await this.eventEmitter.emitAsync(
      UserRoleChangedEvent.name,
      new UserRoleChangedEvent(userId)
    );
    this.eventEmitter.emit(UserUpdatedEvent.name, new UserUpdatedEvent(userId));
  }

  @Get('cursor')
  @Authorize(['read', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cursor-paginated roles for the admin list page' })
  @ApiOkResponse({ description: 'Cursor-paginated list of roles' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  findAllCursor(@Query() query: RoleCursorQueryDto) {
    return this.roleService.findCursorPaginated(query);
  }

  @Get()
  @Authorize(['read', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all roles' })
  @ApiOkResponse({ description: 'List of roles' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden - insufficient permissions' })
  findAll() {
    // Admin catalog, deliberately unscoped by ABAC: it backs the assign-role
    // picker. Conditions apply on mutations and on /roles/:id.
    return this.roleService.findAll();
  }

  @Get('permissions')
  @Authorize(['read', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all available permissions' })
  @ApiOkResponse({ description: 'List of permissions' })
  findAllPermissions() {
    // Admin catalog, deliberately unscoped by ABAC; see findAll().
    return this.roleService.findAllPermissions();
  }

  @Get(':id')
  @Authorize(['read', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a role by ID' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiOkResponse({ description: 'The role' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    return this.roleService.findOne(id, ability, req.user?.userId);
  }

  @Get(':id/permissions')
  @Authorize(['read', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get permissions assigned to a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiOkResponse({ description: 'List of role permissions' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  getPermissionsForRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    return this.roleService.getPermissionsForRole(
      id,
      ability,
      req.user?.userId
    );
  }

  @Post()
  @Authorize(['create', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new role' })
  @ApiBody({ type: CreateRoleDto })
  @ApiCreatedResponse({ description: 'Role created' })
  create(
    @Body() createRoleDto: CreateRoleDto,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    return this.roleService.create(
      createRoleDto,
      ability,
      req.user?.userId,
      (role) =>
        this.auditRow(req, {
          action: AuditAction.ROLE_CREATE,
          targetType: 'Role',
          targetId: role.id,
          details: { name: createRoleDto.name }
        })
    );
  }

  @Patch(':id')
  @Authorize(['update', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiBody({ type: UpdateRoleDto })
  @ApiOkResponse({ description: 'Role updated' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    return this.roleService.update(
      id,
      updateRoleDto,
      ability,
      req.user?.userId,
      (before) =>
        this.auditRow(req, {
          action: AuditAction.ROLE_UPDATE,
          targetType: 'Role',
          targetId: id,
          details: { changedFields: changedFields(before, updateRoleDto) }
        })
    );
  }

  @Delete(':id')
  @Authorize(['delete', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiOkResponse({ description: 'Role deleted' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    // The row is gone after the delete, so the name is recorded here: a bare
    // targetId resolves to nothing once the role no longer exists.
    await this.roleService.delete(id, ability, req.user?.userId, (role) =>
      this.auditRow(req, {
        action: AuditAction.ROLE_DELETE,
        targetType: 'Role',
        targetId: id,
        details: { name: role.name }
      })
    );
  }

  @Put(':id/permissions')
  @Authorize(['update', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Set the full permission set for a role (replaces existing)'
  })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiBody({ type: SetPermissionsDto })
  @ApiOkResponse({ description: 'Permissions updated' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  setPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPermissionsDto,
    @CurrentAbility() ability: AppAbility,
    @Req() req: JwtAuthRequest
  ) {
    return this.roleService.setPermissionsForRole(
      id,
      dto.items,
      ability,
      req.user?.userId,
      this.auditRow(req, {
        action: AuditAction.PERMISSION_ASSIGN,
        targetType: 'Role',
        targetId: id,
        details: { permissionIds: dto.items.map((i) => i.permissionId) }
      })
    );
  }

  @Post(':id/permissions')
  @Authorize(['update', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign permissions to a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiBody({ type: AssignPermissionsDto })
  @ApiOkResponse({ description: 'Permissions assigned' })
  assignPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignPermissionsDto,
    @CurrentAbility() ability: AppAbility,
    @Req() req: JwtAuthRequest
  ) {
    return this.roleService.assignPermissionsToRole(
      id,
      dto.permissionIds,
      dto.conditions,
      ability,
      req.user?.userId,
      this.auditRow(req, {
        action: AuditAction.PERMISSION_ASSIGN,
        targetType: 'Role',
        targetId: id,
        details: { permissionIds: dto.permissionIds }
      })
    );
  }

  @Delete(':id/permissions/:permissionId')
  @Authorize(['update', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a permission from a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiParam({ name: 'permissionId', description: 'The permission ID' })
  @ApiOkResponse({ description: 'Permission removed' })
  removePermission(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
    @CurrentAbility() ability: AppAbility,
    @Req() req: JwtAuthRequest
  ) {
    return this.roleService.removePermissionFromRole(
      id,
      permissionId,
      ability,
      req.user?.userId,
      this.auditRow(req, {
        action: AuditAction.PERMISSION_UNASSIGN,
        targetType: 'Role',
        targetId: id,
        details: { permissionId }
      })
    );
  }

  @Post('assign/:userId')
  @Authorize(['assign', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Assign a role to a user' })
  @ApiParam({ name: 'userId', description: 'The user ID' })
  @ApiBody({ type: AssignRoleDto })
  @ApiOkResponse({ description: 'Role assigned' })
  async assignRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: AssignRoleDto,
    @CurrentAbility() ability: AppAbility,
    @Req() req: JwtAuthRequest
  ) {
    const result = await this.roleService.assignRoleToUser(
      userId,
      dto.roleId,
      ability,
      req.user?.userId,
      this.auditRow(req, {
        action: AuditAction.ROLE_ASSIGN,
        targetType: 'User',
        targetId: userId,
        details: { roleId: dto.roleId }
      })
    );
    await this.emitUserRolesChanged(userId);
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
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @CurrentAbility() ability: AppAbility,
    @Req() req: JwtAuthRequest
  ) {
    const result = await this.roleService.removeRoleFromUser(
      userId,
      roleId,
      ability,
      req.user?.userId,
      this.auditRow(req, {
        action: AuditAction.ROLE_UNASSIGN,
        targetType: 'User',
        targetId: userId,
        details: { roleId }
      })
    );
    await this.emitUserRolesChanged(userId);
    return result;
  }
}
