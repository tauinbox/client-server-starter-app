import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
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
import { ErrorKeys } from '@app/shared/constants';
import { changedFields } from '@app/shared/utils/changed-fields';
import { ResourceCursorQueryDto } from '../../../common/dtos';
import { ResourceService } from '../services/resource.service';
import { Authorize } from '../decorators/authorize.decorator';
import { CurrentAbility } from '../decorators/current-ability.decorator';
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
  displayName: 'Permissions',
  actions: ['read', 'update'],
  conditionalActions: ['update']
})
export class RbacController {
  constructor(
    private readonly resourceService: ResourceService,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {}

  // ── Metadata ──────────────────────────────────────────────────────

  @Get('metadata')
  @Authorize(['read', 'Permission'])
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get RBAC metadata (resources)' })
  @ApiOkResponse({ description: 'RBAC metadata' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  async getMetadata() {
    // Admin catalog, deliberately unscoped by ABAC: a display-name lookup
    // over every resource. Conditions apply on mutations and reads by id.
    const cached = await this.cacheManager.get(METADATA_CACHE_KEY);
    if (cached) return cached;

    const result = { resources: await this.resourceService.findAll() };
    await this.cacheManager.set(METADATA_CACHE_KEY, result, METADATA_CACHE_TTL);
    return result;
  }

  // ── Resources (read + update display info only) ──────────────────

  @Get('resources/cursor')
  @Authorize(['read', 'Permission'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cursor-paginated resources for the list page' })
  @ApiOkResponse({ description: 'Cursor-paginated list of resources' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  findAllResourcesCursor(@Query() query: ResourceCursorQueryDto) {
    return this.resourceService.findCursorPaginated(query);
  }

  @Get('resources')
  @Authorize(['read', 'Permission'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all registered resources' })
  @ApiOkResponse({ description: 'List of resources' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden' })
  findAllResources() {
    // Admin catalog, deliberately unscoped by ABAC; see getMetadata().
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
    const changed = changedFields(resource, dto);
    const result = await this.resourceService.update(id, dto);
    await this.cacheManager.del(METADATA_CACHE_KEY);
    await this.auditService.log({
      action: AuditAction.RESOURCE_UPDATE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'Resource',
      details: { changedFields: changed },
      context: extractAuditContext(req)
    });
    return result;
  }
}
