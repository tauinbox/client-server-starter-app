import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  SerializeOptions,
  UseInterceptors
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
import { subject } from '@casl/ability';
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
import { LogAudit } from '../../audit/decorators/log-audit.decorator';
import { AuditService } from '../../audit/audit.service';
import { assertCan } from '../../../common/utils/assert-can.util';
import { MetricsService } from '../../core/metrics/metrics.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRoleChangedEvent } from '../events/user-role-changed.event';
import type { JwtAuthRequest } from '../types/auth.request';

@ApiTags('Roles API')
@Controller({
  path: 'roles',
  version: '1'
})
@RegisterResource({ name: 'roles', subject: 'Role', displayName: 'Roles' })
@UseInterceptors(ClassSerializerInterceptor)
@SerializeOptions({ groups: ['privileged'] })
export class RolesController {
  constructor(
    private readonly roleService: RoleService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService
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
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const role = await this.roleService.findOne(id);
    assertCan(
      ability,
      'read',
      subject('Role', role),
      this.auditService,
      { actorId: req.user?.userId, targetId: id, targetType: 'Role' },
      this.metricsService
    );
    return role;
  }

  @Get(':id/permissions')
  @Authorize(['read', 'Role'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get permissions assigned to a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiOkResponse({ description: 'List of role permissions' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async getPermissionsForRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const role = await this.roleService.findOne(id);
    assertCan(
      ability,
      'read',
      subject('Role', role),
      this.auditService,
      { actorId: req.user?.userId, targetId: id, targetType: 'Role' },
      this.metricsService
    );
    return this.roleService.getPermissionsForRole(id);
  }

  @Post()
  @Authorize(['create', 'Role'])
  @LogAudit({
    action: AuditAction.ROLE_CREATE,
    targetType: 'Role',
    targetIdFromResponse: (response) => (response as { id?: string })?.id,
    details: ({ body }) => ({ name: (body as CreateRoleDto).name })
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new role' })
  @ApiBody({ type: CreateRoleDto })
  @ApiCreatedResponse({ description: 'Role created' })
  create(@Body() createRoleDto: CreateRoleDto) {
    return this.roleService.create(createRoleDto);
  }

  @Patch(':id')
  @Authorize(['update', 'Role'])
  @LogAudit({
    action: AuditAction.ROLE_UPDATE,
    targetType: 'Role',
    details: ({ body }) => ({
      changedFields: Object.keys(body as UpdateRoleDto)
    })
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiBody({ type: UpdateRoleDto })
  @ApiOkResponse({ description: 'Role updated' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateRoleDto: UpdateRoleDto,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const role = await this.roleService.findOne(id);
    assertCan(
      ability,
      'update',
      subject('Role', role),
      this.auditService,
      { actorId: req.user?.userId, targetId: id, targetType: 'Role' },
      this.metricsService
    );
    return this.roleService.update(id, updateRoleDto);
  }

  @Delete(':id')
  @Authorize(['delete', 'Role'])
  @LogAudit({
    action: AuditAction.ROLE_DELETE,
    targetType: 'Role'
  })
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
    const role = await this.roleService.findOne(id);
    assertCan(
      ability,
      'delete',
      subject('Role', role),
      this.auditService,
      { actorId: req.user?.userId, targetId: id, targetType: 'Role' },
      this.metricsService
    );
    return this.roleService.delete(id);
  }

  @Put(':id/permissions')
  @Authorize(['update', 'Role'])
  @LogAudit({
    action: AuditAction.PERMISSION_ASSIGN,
    targetType: 'Role',
    details: ({ body }) => ({
      permissionIds: (body as SetPermissionsDto).items.map(
        (i) => i.permissionId
      )
    })
  })
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
      req.user?.userId
    );
  }

  @Post(':id/permissions')
  @Authorize(['update', 'Role'])
  @LogAudit({
    action: AuditAction.PERMISSION_ASSIGN,
    targetType: 'Role',
    details: ({ body }) => ({
      permissionIds: (body as AssignPermissionsDto).permissionIds
    })
  })
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
      req.user?.userId
    );
  }

  @Delete(':id/permissions/:permissionId')
  @Authorize(['update', 'Role'])
  @LogAudit({
    action: AuditAction.PERMISSION_UNASSIGN,
    targetType: 'Role',
    details: ({ params }) => ({ permissionId: params['permissionId'] })
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a permission from a role' })
  @ApiParam({ name: 'id', description: 'The role ID' })
  @ApiParam({ name: 'permissionId', description: 'The permission ID' })
  @ApiOkResponse({ description: 'Permission removed' })
  removePermission(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
    @CurrentAbility() ability: AppAbility
  ) {
    return this.roleService.removePermissionFromRole(id, permissionId, ability);
  }

  @Post('assign/:userId')
  @Authorize(['assign', 'Role'])
  @LogAudit({
    action: AuditAction.ROLE_ASSIGN,
    targetType: 'User',
    targetIdParam: 'userId',
    details: ({ body }) => ({ roleId: (body as AssignRoleDto).roleId })
  })
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
      req.user?.userId
    );
    this.eventEmitter.emit(
      UserRoleChangedEvent.name,
      new UserRoleChangedEvent(userId)
    );
    return result;
  }

  @Delete('assign/:userId/:roleId')
  @Authorize(['assign', 'Role'])
  @LogAudit({
    action: AuditAction.ROLE_UNASSIGN,
    targetType: 'User',
    targetIdParam: 'userId',
    details: ({ params }) => ({ roleId: params['roleId'] })
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a role from a user' })
  @ApiParam({ name: 'userId', description: 'The user ID' })
  @ApiParam({ name: 'roleId', description: 'The role ID' })
  @ApiOkResponse({ description: 'Role removed' })
  async removeRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @CurrentAbility() ability: AppAbility
  ) {
    const result = await this.roleService.removeRoleFromUser(
      userId,
      roleId,
      ability
    );
    this.eventEmitter.emit(
      UserRoleChangedEvent.name,
      new UserRoleChangedEvent(userId)
    );
    return result;
  }
}
