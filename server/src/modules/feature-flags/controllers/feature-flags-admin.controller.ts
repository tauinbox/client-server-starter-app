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
  Put,
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
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import { Authorize } from '../../auth/decorators/authorize.decorator';
import { RegisterResource } from '../../auth/decorators/register-resource.decorator';
import { LogAudit } from '../../audit/decorators/log-audit.decorator';
import { JwtAuthRequest } from '../../auth/types/auth.request';
import { FeatureFlagService } from '../services/feature-flag.service';
import { CreateFeatureFlagDto } from '../dtos/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from '../dtos/update-feature-flag.dto';
import { ReplaceRulesDto } from '../dtos/replace-rules.dto';
import { FeatureFlagResponseDto } from '../dtos/feature-flag-response.dto';
import { PreviewFlagContextDto } from '../dtos/preview-flag-context.dto';
import { PreviewFlagResponseDto } from '../dtos/preview-flag-response.dto';
import { FeatureFlagChangedEvent } from '../events/feature-flag-changed.event';

@ApiTags('Feature Flags Admin API')
@Controller({
  path: 'admin/feature-flags',
  version: '1'
})
@RegisterResource({
  name: 'feature-flags',
  subject: 'FeatureFlag',
  displayName: 'Feature Flags'
})
@UseInterceptors(ClassSerializerInterceptor)
export class FeatureFlagsAdminController {
  constructor(
    private readonly flagService: FeatureFlagService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  @Get()
  @Authorize(['manage', 'FeatureFlag'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all feature flags' })
  @ApiOkResponse({ type: [FeatureFlagResponseDto] })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  findAll() {
    return this.flagService.findAll();
  }

  @Get(':id')
  @Authorize(['manage', 'FeatureFlag'])
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a feature flag by ID' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: FeatureFlagResponseDto })
  @ApiNotFoundResponse({ description: 'Feature flag not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.flagService.findOne(id);
  }

  @Post()
  @Authorize(['manage', 'FeatureFlag'])
  @LogAudit({
    action: AuditAction.FEATURE_FLAG_CREATE,
    targetType: 'FeatureFlag',
    targetIdFromResponse: (response) => (response as { id?: string })?.id,
    details: ({ body, response }) => ({
      key: (body as CreateFeatureFlagDto).key,
      flagId: (response as { id?: string })?.id
    })
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a feature flag' })
  @ApiBody({ type: CreateFeatureFlagDto })
  @ApiCreatedResponse({ type: FeatureFlagResponseDto })
  async create(@Body() dto: CreateFeatureFlagDto, @Req() req: JwtAuthRequest) {
    const flag = await this.flagService.create(dto, req.user?.userId ?? null);
    this.eventEmitter.emit(
      FeatureFlagChangedEvent.name,
      new FeatureFlagChangedEvent(flag.key, 'created')
    );
    return flag;
  }

  @Patch(':id')
  @Authorize(['manage', 'FeatureFlag'])
  @LogAudit({
    action: AuditAction.FEATURE_FLAG_UPDATE,
    targetType: 'FeatureFlag',
    details: ({ body }) => ({ changedFields: Object.keys(body as object) })
  })
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
    @Req() req: JwtAuthRequest
  ) {
    const expectedVersion = this.parseIfMatch(ifMatch);
    const flag = await this.flagService.update(
      id,
      dto,
      expectedVersion,
      req.user?.userId ?? null
    );
    this.eventEmitter.emit(
      FeatureFlagChangedEvent.name,
      new FeatureFlagChangedEvent(flag.key, 'updated')
    );
    return flag;
  }

  @Delete(':id')
  @Authorize(['manage', 'FeatureFlag'])
  @LogAudit({
    action: AuditAction.FEATURE_FLAG_DELETE,
    targetType: 'FeatureFlag'
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a feature flag' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Deleted' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const flag = await this.flagService.findOne(id);
    await this.flagService.delete(id);
    this.eventEmitter.emit(
      FeatureFlagChangedEvent.name,
      new FeatureFlagChangedEvent(flag.key, 'deleted')
    );
  }

  @Put(':id/rules')
  @Authorize(['manage', 'FeatureFlag'])
  @LogAudit({
    action: AuditAction.FEATURE_FLAG_RULES_REPLACE,
    targetType: 'FeatureFlag',
    details: ({ body }) => ({
      ruleCount: (body as ReplaceRulesDto).rules.length
    })
  })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace the full rule set for a feature flag' })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: ReplaceRulesDto })
  @ApiOkResponse({ type: FeatureFlagResponseDto })
  async replaceRules(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceRulesDto,
    @Req() req: JwtAuthRequest
  ) {
    const flag = await this.flagService.replaceRules(
      id,
      dto.rules,
      req.user?.userId ?? null
    );
    this.eventEmitter.emit(
      FeatureFlagChangedEvent.name,
      new FeatureFlagChangedEvent(flag.key, 'rules-replaced')
    );
    return flag;
  }

  @Post(':id/preview')
  @Authorize(['manage', 'FeatureFlag'])
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Dry-run a feature flag against a synthetic context — non-mutating, no audit log'
  })
  @ApiParam({ name: 'id' })
  @ApiBody({ type: PreviewFlagContextDto })
  @ApiOkResponse({ type: PreviewFlagResponseDto })
  @ApiNotFoundResponse({ description: 'Feature flag not found' })
  preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PreviewFlagContextDto
  ) {
    return this.flagService.preview(id, dto);
  }

  @Post(':id/toggle')
  @Authorize(['manage', 'FeatureFlag'])
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
    @Req() req: JwtAuthRequest
  ) {
    const flag = await this.flagService.toggle(id, req.user?.userId ?? null);
    this.eventEmitter.emit(
      FeatureFlagChangedEvent.name,
      new FeatureFlagChangedEvent(flag.key, 'toggled')
    );
    return flag;
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
