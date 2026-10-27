import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse
} from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ErrorKeys } from '@app/shared/constants';
import {
  parseIfMatch,
  versionEtag,
  type IfMatchCondition
} from '@app/shared/utils/if-match';
import { FeatureFlagCursorQueryDto } from '../../../common/dtos';
import { ApiError } from '../../../common/errors/api-error';
import { Authorize } from '../../auth/decorators/authorize.decorator';
import { CurrentAbility } from '../../auth/decorators/current-ability.decorator';
import type { AppAbility } from '../../auth/casl/app-ability';
import { RegisterResource } from '../../auth/decorators/register-resource.decorator';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { JwtAuthRequest } from '../../auth/types/auth.request';
import {
  FeatureFlagService,
  type FlagAuditActor
} from '../services/feature-flag.service';
import { CreateFeatureFlagDto } from '../dtos/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from '../dtos/update-feature-flag.dto';
import { FeatureFlagResponseDto } from '../dtos/feature-flag-response.dto';
import { PreviewFlagContextDto } from '../dtos/preview-flag-context.dto';
import { PreviewFlagResponseDto } from '../dtos/preview-flag-response.dto';
import { FeatureFlagChangedEvent } from '../events/feature-flag-changed.event';
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
export class FeatureFlagsAdminController {
  constructor(
    private readonly flagService: FeatureFlagService,
    private readonly eventEmitter: EventEmitter2
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
    @CurrentAbility() ability: AppAbility,
    @Res({ passthrough: true }) res: Response
  ) {
    const flag = await this.flagService.findOne(id, ability, req.user?.userId);
    res.setHeader('ETag', versionEtag(flag.version));
    return flag;
  }

  @Post()
  @Authorize(['create', 'FeatureFlag'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a feature flag' })
  @ApiBody({ type: CreateFeatureFlagDto })
  @ApiCreatedResponse({ type: FeatureFlagResponseDto })
  async create(
    @Body() dto: CreateFeatureFlagDto,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility,
    @Res({ passthrough: true }) res: Response
  ) {
    const flag = await this.flagService.create(
      dto,
      ability,
      this.auditActor(req)
    );
    this.eventEmitter.emit(
      FeatureFlagChangedEvent.name,
      new FeatureFlagChangedEvent()
    );
    res.setHeader('ETag', versionEtag(flag.version));
    return flag;
  }

  @Patch(':id')
  @Authorize(['update', 'FeatureFlag'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a feature flag (optimistic locking)' })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description:
      'The ETag of the flag as the caller last read it, for example "3" (RFC 9110 13.1.1)'
  })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: UpdateFeatureFlagDto })
  @ApiOkResponse({ type: FeatureFlagResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFeatureFlagDto,
    @Headers('if-match') ifMatch: string | undefined,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility,
    @Res({ passthrough: true }) res: Response
  ) {
    const condition = this.parseIfMatch(ifMatch);
    const flag = await this.flagService.update(
      id,
      dto,
      condition,
      ability,
      this.auditActor(req)
    );
    this.eventEmitter.emit(
      FeatureFlagChangedEvent.name,
      new FeatureFlagChangedEvent()
    );
    res.setHeader('ETag', versionEtag(flag.version));
    return flag;
  }

  @Delete(':id')
  @Authorize(['delete', 'FeatureFlag'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a feature flag' })
  @ApiParam({ name: 'id' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: JwtAuthRequest,
    @CurrentAbility() ability: AppAbility
  ) {
    await this.flagService.delete(id, ability, this.auditActor(req));
    this.eventEmitter.emit(
      FeatureFlagChangedEvent.name,
      new FeatureFlagChangedEvent()
    );
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
    const flag = await this.flagService.findOne(id, ability, req.user?.userId);
    return this.flagService.preview(flag, dto);
  }

  private auditActor(req: JwtAuthRequest): FlagAuditActor {
    return {
      actorId: req.user?.userId ?? null,
      actorEmail: req.user?.email ?? null,
      context: extractAuditContext(req)
    };
  }

  private parseIfMatch(header: string | undefined): IfMatchCondition {
    const condition = parseIfMatch(header);
    if (condition === 'missing') {
      throw new ApiError(
        ErrorKeys.FEATURE_FLAGS.IF_MATCH_REQUIRED,
        'If-Match header is required for optimistic locking'
      );
    }
    if (condition === 'invalid') {
      throw new ApiError(
        ErrorKeys.FEATURE_FLAGS.IF_MATCH_INVALID,
        'If-Match must be "*" or a list of entity tags'
      );
    }
    return condition;
  }
}
