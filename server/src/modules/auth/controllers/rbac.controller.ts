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
import { Throttle } from '@nestjs/throttler';
import { ResourceService } from '../services/resource.service';
import { ActionService } from '../services/action.service';
import { Authorize } from '../decorators/authorize.decorator';
import { CreateActionDto } from '../dtos/create-action.dto';
import { UpdateActionDto } from '../dtos/update-action.dto';
import { UpdateResourceDto } from '../dtos/update-resource.dto';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { JwtAuthRequest } from '../types/auth.request';
import { RegisterResource } from '../decorators/register-resource.decorator';

@ApiTags('RBAC Metadata')
@Controller({
  path: 'rbac',
  version: '1'
})
@RegisterResource({
  name: 'permissions',
  subject: 'Permission',
  displayName: 'Permissions'
})
export class RbacController {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly actionService: ActionService,
    private readonly auditService: AuditService
  ) {}

  // ── Metadata (public, no auth required) ──────────────────────────

  @Get('metadata')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({
    summary: 'Get RBAC metadata (resources and actions)'
  })
  @ApiOkResponse({ description: 'RBAC metadata' })
  async getMetadata() {
    const [resources, actions] = await Promise.all([
      this.resourceService.findAll(),
      this.actionService.findAll()
    ]);
    return { resources, actions };
  }

  // ── Resources (read + update display info only) ──────────────────

  @Get('resources')
  @Authorize(['read', 'Permission'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all registered resources' })
  @ApiOkResponse({ description: 'List of resources' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  findAllResources() {
    return this.resourceService.findAll();
  }

  @Patch('resources/:id')
  @Authorize(['update', 'Permission'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update resource display name or description' })
  @ApiParam({ name: 'id', description: 'The resource ID' })
  @ApiBody({ type: UpdateResourceDto })
  @ApiOkResponse({ description: 'Resource updated' })
  @ApiNotFoundResponse({ description: 'Resource not found' })
  async updateResource(
    @Param('id') id: string,
    @Body() dto: UpdateResourceDto,
    @Request() req: JwtAuthRequest
  ) {
    const result = await this.resourceService.update(id, dto);
    await this.auditService.log({
      action: AuditAction.RESOURCE_UPDATE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'Resource',
      details: { changedFields: Object.keys(dto) },
      context: extractAuditContext(req)
    });
    return result;
  }

  // ── Actions (full CRUD) ──────────────────────────────────────────

  @Get('actions')
  @Authorize(['read', 'Permission'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all actions' })
  @ApiOkResponse({ description: 'List of actions' })
  findAllActions() {
    return this.actionService.findAll();
  }

  @Post('actions')
  @Authorize(['create', 'Permission'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new action' })
  @ApiBody({ type: CreateActionDto })
  @ApiCreatedResponse({ description: 'Action created' })
  async createAction(
    @Body() dto: CreateActionDto,
    @Request() req: JwtAuthRequest
  ) {
    const action = await this.actionService.create(dto);
    await this.auditService.log({
      action: AuditAction.ACTION_CREATE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: action.id,
      targetType: 'Action',
      details: { name: dto.name },
      context: extractAuditContext(req)
    });
    return action;
  }

  @Patch('actions/:id')
  @Authorize(['update', 'Permission'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an action' })
  @ApiParam({ name: 'id', description: 'The action ID' })
  @ApiBody({ type: UpdateActionDto })
  @ApiOkResponse({ description: 'Action updated' })
  @ApiNotFoundResponse({ description: 'Action not found' })
  async updateAction(
    @Param('id') id: string,
    @Body() dto: UpdateActionDto,
    @Request() req: JwtAuthRequest
  ) {
    const result = await this.actionService.update(id, dto);
    await this.auditService.log({
      action: AuditAction.ACTION_UPDATE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'Action',
      details: { changedFields: Object.keys(dto) },
      context: extractAuditContext(req)
    });
    return result;
  }

  @Delete('actions/:id')
  @Authorize(['delete', 'Permission'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a custom action' })
  @ApiParam({ name: 'id', description: 'The action ID' })
  @ApiOkResponse({ description: 'Action deleted' })
  @ApiNotFoundResponse({ description: 'Action not found' })
  async deleteAction(@Param('id') id: string, @Request() req: JwtAuthRequest) {
    await this.actionService.delete(id);
    await this.auditService.log({
      action: AuditAction.ACTION_DELETE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'Action',
      context: extractAuditContext(req)
    });
  }
}
