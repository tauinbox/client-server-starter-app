import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
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
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { subject } from '@casl/ability';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import { ResourceService } from '../services/resource.service';
import { ActionService } from '../services/action.service';
import { Authorize } from '../decorators/authorize.decorator';
import { CurrentAbility } from '../decorators/current-ability.decorator';
import { CreateActionDto } from '../dtos/create-action.dto';
import { UpdateActionDto } from '../dtos/update-action.dto';
import { UpdateResourceDto } from '../dtos/update-resource.dto';
import { AuditService } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { assertCan } from '../../../common/utils/assert-can.util';
import { MetricsService } from '../../core/metrics/metrics.service';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { JwtAuthRequest } from '../types/auth.request';
import type { AppAbility } from '../casl/app-ability';
import { RegisterResource } from '../decorators/register-resource.decorator';

const METADATA_CACHE_KEY = 'rbac:metadata';
const METADATA_CACHE_TTL = 60_000; // 1 minute

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
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {}

  // ── Metadata ──────────────────────────────────────────────────────

  @Get('metadata')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get RBAC metadata (resources and actions)' })
  @ApiOkResponse({ description: 'RBAC metadata' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  async getMetadata() {
    const cached = await this.cacheManager.get(METADATA_CACHE_KEY);
    if (cached) return cached;

    const [resources, actions] = await Promise.all([
      this.resourceService.findAll(),
      this.actionService.findAll()
    ]);
    const result = { resources, actions };
    await this.cacheManager.set(METADATA_CACHE_KEY, result, METADATA_CACHE_TTL);
    return result;
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

  @Post('resources/:id/restore')
  @HttpCode(200)
  @Authorize(['update', 'Permission'])
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Restore an orphaned resource (re-enable its permissions)'
  })
  @ApiParam({ name: 'id', description: 'The resource ID' })
  @ApiOkResponse({ description: 'Resource restored' })
  @ApiNotFoundResponse({ description: 'Resource not found' })
  async restoreResource(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const resource = await this.resourceService.findOne(id);
    if (!resource) {
      throw new HttpException(
        {
          message: 'Resource not found',
          errorKey: ErrorKeys.RESOURCES.NOT_FOUND
        },
        HttpStatus.NOT_FOUND
      );
    }
    assertCan(
      ability,
      'update',
      subject('Permission', resource),
      this.auditService,
      { actorId: req.user.userId, targetId: id, targetType: 'Resource' },
      this.metricsService
    );
    const result = await this.resourceService.restore(id);
    await this.cacheManager.del(METADATA_CACHE_KEY);
    await this.auditService.log({
      action: AuditAction.RESOURCE_RESTORE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'Resource',
      context: extractAuditContext(req)
    });
    return result;
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateResourceDto,
    @Request() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const resource = await this.resourceService.findOne(id);
    if (!resource) {
      throw new HttpException(
        {
          message: 'Resource not found',
          errorKey: ErrorKeys.RESOURCES.NOT_FOUND
        },
        HttpStatus.NOT_FOUND
      );
    }
    assertCan(
      ability,
      'update',
      subject('Permission', resource),
      this.auditService,
      { actorId: req.user.userId, targetId: id, targetType: 'Resource' },
      this.metricsService
    );
    const result = await this.resourceService.update(id, dto);
    await this.cacheManager.del(METADATA_CACHE_KEY);
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
    await this.cacheManager.del(METADATA_CACHE_KEY);
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateActionDto,
    @Request() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const action = await this.actionService.findOne(id);
    assertCan(
      ability,
      'update',
      subject('Permission', action),
      this.auditService,
      { actorId: req.user.userId, targetId: id, targetType: 'Action' },
      this.metricsService
    );
    const result = await this.actionService.update(id, dto);
    await this.cacheManager.del(METADATA_CACHE_KEY);
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
  async deleteAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const action = await this.actionService.findOne(id);
    assertCan(
      ability,
      'delete',
      subject('Permission', action),
      this.auditService,
      { actorId: req.user.userId, targetId: id, targetType: 'Action' },
      this.metricsService
    );
    await this.actionService.delete(id);
    await this.cacheManager.del(METADATA_CACHE_KEY);
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
