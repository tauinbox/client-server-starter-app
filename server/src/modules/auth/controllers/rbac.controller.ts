import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { changedFields } from '@app/shared/utils/changed-fields';
import { ResourceCursorQueryDto } from '../../../common/dtos';
import { ResourceService } from '../services/resource.service';
import { Authorize } from '../decorators/authorize.decorator';
import { CurrentAbility } from '../decorators/current-ability.decorator';
import { UpdateResourceDto } from '../dtos/update-resource.dto';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { extractAuditContext } from '../../../common/utils/audit-context.util';
import { JwtAuthRequest } from '../types/auth.request';
import type { AppAbility } from '../casl/app-ability';
import { RegisterResource } from '../decorators/register-resource.decorator';

@ApiTags('RBAC Metadata')
@Controller({
  path: 'rbac',
  version: '1'
})
@RegisterResource({
  name: 'permissions',
  subject: 'Permission',
  displayName: 'Permissions',
  description: 'Permission and RBAC metadata management',
  actions: ['read', 'update'],
  conditionalActions: ['update']
})
export class RbacController {
  constructor(private readonly resourceService: ResourceService) {}

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
    // Admin catalog, deliberately unscoped by ABAC: a display-name lookup
    // over every resource. Conditions apply on mutations and reads by id.
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
    return this.resourceService.restore(id, ability, req.user.userId, {
      action: AuditAction.RESOURCE_RESTORE,
      actorId: req.user.userId,
      actorEmail: req.user.email,
      targetId: id,
      targetType: 'Resource',
      context: extractAuditContext(req)
    });
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
    return this.resourceService.update(
      id,
      dto,
      ability,
      req.user.userId,
      (before) => ({
        action: AuditAction.RESOURCE_UPDATE,
        actorId: req.user.userId,
        actorEmail: req.user.email,
        targetId: id,
        targetType: 'Resource',
        details: { changedFields: changedFields(before, dto) },
        context: extractAuditContext(req)
      })
    );
  }
}
