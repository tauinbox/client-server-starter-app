import {
  BadRequestException,
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseInterceptors
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { subject } from '@casl/ability';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ErrorKeys } from '@app/shared/constants';
import { changedFields } from '@app/shared/utils/changed-fields';
import { FeatureFlagCursorQueryDto } from '../../../common/dtos';
import { assertCan } from '../../../common/utils/assert-can.util';
import { Authorize } from '../../auth/decorators/authorize.decorator';
import { CurrentAbility } from '../../auth/decorators/current-ability.decorator';
import type { AppAbility } from '../../auth/casl/app-ability';
import { MetricsService } from '../../core/metrics/metrics.service';
import { RegisterResource } from '../../auth/decorators/register-resource.decorator';
import { LogAudit } from '../../audit/decorators/log-audit.decorator';
import { AuditService } from '../../audit/audit.service';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { JwtAuthRequest } from '../../auth/types/auth.request';
import { FeatureFlagService } from '../services/feature-flag.service';
import { CreateFeatureFlagDto } from '../dtos/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from '../dtos/update-feature-flag.dto';
import { FeatureFlagResponseDto } from '../dtos/feature-flag-response.dto';
import { PreviewFlagContextDto } from '../dtos/preview-flag-context.dto';
import { PreviewFlagResponseDto } from '../dtos/preview-flag-response.dto';
import { FeatureFlagChangedEvent } from '../events/feature-flag-changed.event';
import type { FeatureFlag } from '../entities/feature-flag.entity';
import type { FeatureFlagAttributeKeysResponse } from '@app/shared/types';

@ApiTags('Feature Flags Admin API')
@Controller({
  path: 'admin/feature-flags',
  version: '1'
})
@RegisterResource({
  name: 'feature-flags',
  subject: 'FeatureFlag',
  displayName: 'Feature Flags',
  description: 'Feature flag administration',
  actions: ['create', 'read', 'update', 'delete', 'search'],
  conditionalActions: ['create', 'read', 'update', 'delete', 'search']
})
@UseInterceptors(ClassSerializerInterceptor)
export class FeatureFlagsAdminController {
  constructor(
    private readonly flagService: FeatureFlagService,
    private readonly eventEmitter: EventEmitter2,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService
  ) {}

  @Get('cursor')
  @Authorize(['search', 'FeatureFlag'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cursor-paginated feature flags for the list page' })
  @ApiOkResponse({ description: 'Cursor-paginated list of feature flags' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  findAllCursor(
    @Query() query: FeatureFlagCursorQueryDto,
    @CurrentAbility() ability: AppAbility
  ) {
    return this.flagService.findCursorPaginated(query, ability);
  }

  @Get('attribute-keys')
  @Authorize(['search', 'FeatureFlag'])
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Custom attribute keys accepted in a rule payload'
  })
  @ApiOkResponse({ description: 'Registered custom attribute keys' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getAttributeKeys(): FeatureFlagAttributeKeysResponse {
    return this.flagService.getAttributeCustomKeys();
  }

  @Get(':id')
  @Authorize(['read', 'FeatureFlag'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a feature flag by ID' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: FeatureFlagResponseDto })
  @ApiNotFoundResponse({ description: 'Feature flag not found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const flag = await this.flagService.findOne(id);
    this.assertCanFlag(ability, 'read', flag, req, id);
    return flag;
  }

  @Post()
  @Authorize(['create', 'FeatureFlag'])
  @LogAudit({
    action: AuditAction.FEATURE_FLAG_CREATE,
    targetType: 'FeatureFlag',
    targetIdFromResponse: (response) => (response as { id?: string })?.id,
    details: ({ body, response }) => {
      const { key, rules } = body as CreateFeatureFlagDto;
      return {
        key,
        flagId: (response as { id?: string })?.id,
        ...(rules ? { ruleCount: rules.length } : {})
      };
    }
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a feature flag' })
  @ApiBody({ type: CreateFeatureFlagDto })
  @ApiCreatedResponse({ type: FeatureFlagResponseDto })
  async create(
    @Body() dto: CreateFeatureFlagDto,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    this.assertCanFlag(
      ability,
      'create',
      this.flagService.newFlagFields(dto),
      req
    );
    const flag = await this.flagService.create(dto, req.user?.userId ?? null);
    this.eventEmitter.emit(
      FeatureFlagChangedEvent.name,
      new FeatureFlagChangedEvent()
    );
    return flag;
  }

  @Patch(':id')
  @Authorize(['update', 'FeatureFlag'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a feature flag (optimistic locking)' })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'Expected current version number for optimistic locking'
  })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: UpdateFeatureFlagDto })
  @ApiOkResponse({ type: FeatureFlagResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeatureFlagDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const expectedVersion = this.parseIfMatch(ifMatch);
    // The update is conditional on the version, so when it succeeds this read
    // is exactly the state that it replaced. The rules are reported as a
    // count: rule rows and rule DTOs do not compare field by field.
    const { rules, ...fields } = dto;
    const current = await this.flagService.findOne(id);
    // The record after the write is checked too: else a grant scoped by a
    // writable field lets the caller move a flag out of its own scope.
    this.assertCanFlag(ability, 'update', current, req, id);
    this.assertCanFlag(
      ability,
      'update',
      {
        ...current,
        ...Object.fromEntries(
          Object.entries(fields).filter(([, value]) => value !== undefined)
        )
      },
      req,
      id
    );
    const changed = changedFields(current, fields);
    const flag = await this.flagService.update(
      id,
      dto,
      expectedVersion,
      req.user?.userId ?? null
    );
    this.eventEmitter.emit(
      FeatureFlagChangedEvent.name,
      new FeatureFlagChangedEvent()
    );
    await this.auditService.log({
      action: AuditAction.FEATURE_FLAG_UPDATE,
      actorId: req.user?.userId ?? null,
      actorEmail: req.user?.email ?? null,
      targetId: id,
      targetType: 'FeatureFlag',
      details: {
        changedFields: changed,
        ...(rules ? { ruleCount: rules.length } : {})
      },
      context: extractAuditContext(req)
    });
    return flag;
  }

  @Delete(':id')
  @Authorize(['delete', 'FeatureFlag'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a feature flag' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Deleted' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const flag = await this.flagService.findOne(id);
    this.assertCanFlag(ability, 'delete', flag, req, id);
    await this.flagService.delete(flag);
    this.eventEmitter.emit(
      FeatureFlagChangedEvent.name,
      new FeatureFlagChangedEvent()
    );
    // The row is gone after the delete, so the key is recorded here: a bare
    // targetId resolves to nothing once the flag no longer exists.
    await this.auditService.log({
      action: AuditAction.FEATURE_FLAG_DELETE,
      actorId: req.user?.userId ?? null,
      actorEmail: req.user?.email ?? null,
      targetId: id,
      targetType: 'FeatureFlag',
      details: { key: flag.key },
      context: extractAuditContext(req)
    });
  }

  @Post(':id/preview')
  @Authorize(['read', 'FeatureFlag'])
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Dry-run a feature flag against a synthetic context — non-mutating, no audit log',
    description:
      'Evaluates the stored flag by default. A request that carries `rules`, `enabled` or `environments` evaluates those unsaved values instead, so an editor can verify a draft before it saves.'
  })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: PreviewFlagContextDto })
  @ApiOkResponse({ type: PreviewFlagResponseDto })
  @ApiNotFoundResponse({ description: 'Feature flag not found' })
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewFlagContextDto,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    this.assertCanFlag(
      ability,
      'read',
      await this.flagService.findOne(id),
      req,
      id
    );
    return this.flagService.preview(id, dto);
  }

  @Post(':id/toggle')
  @Authorize(['update', 'FeatureFlag'])
  @LogAudit({
    action: AuditAction.FEATURE_FLAG_TOGGLE,
    targetType: 'FeatureFlag',
    details: ({ response }) => ({
      enabled: (response as { enabled?: boolean })?.enabled
    })
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle a feature flag on/off' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: FeatureFlagResponseDto })
  async toggle(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    const current = await this.flagService.findOne(id);
    this.assertCanFlag(ability, 'update', current, req, id);
    this.assertCanFlag(
      ability,
      'update',
      { ...current, enabled: !current.enabled },
      req,
      id
    );
    const flag = await this.flagService.toggle(id, req.user?.userId ?? null);
    this.eventEmitter.emit(
      FeatureFlagChangedEvent.name,
      new FeatureFlagChangedEvent()
    );
    return flag;
  }

  /**
   * The route-level @Authorize check is type-level and ignores conditions, so
   * a conditional grant is re-evaluated against the record.
   */
  private assertCanFlag(
    ability: AppAbility,
    action: string,
    record: Partial<FeatureFlag>,
    req: JwtAuthRequest,
    targetId?: string
  ): void {
    assertCan(
      ability,
      action,
      subject('FeatureFlag', record),
      this.auditService,
      { actorId: req.user?.userId, targetId, targetType: 'FeatureFlag' },
      this.metricsService
    );
  }

  private parseIfMatch(header: string | undefined): number {
    if (header === undefined || header === '') {
      throw new HttpException(
        {
          message: 'If-Match header is required for optimistic locking',
          errorKey: ErrorKeys.FEATURE_FLAGS.IF_MATCH_REQUIRED
        },
        HttpStatus.PRECONDITION_REQUIRED
      );
    }
    const stripped = header.replace(/^"|"$/g, '').trim();
    const parsed = Number.parseInt(stripped, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException('If-Match must be a positive integer');
    }
    return parsed;
  }
}
