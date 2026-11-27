import { Body, Controller, Param, Put, Req } from '@nestjs/common';
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
import type { RegionStatusResponse } from '@app/shared/types';
import { Authorize } from '../../../auth/decorators/authorize.decorator';
import { RegisterResource } from '../../../auth/decorators/register-resource.decorator';
import { JwtAuthRequest } from '../../../auth/types/auth.request';
import { extractAuditContext } from '../../../../common/utils/audit-context.util';
import { RegionRegistryService } from '../region-registry.service';
import { SetRegionStatusDto } from '../dtos/set-region-status.dto';
import { RegionStatusResponseDto } from '../dtos/region-status-response.dto';

@ApiTags('Regions Admin API')
@Controller({
  path: 'admin/regions',
  version: '1'
})
@RegisterResource({
  name: 'regions',
  subject: 'Region',
  displayName: 'Regions',
  description: 'The public status of each data region',
  actions: ['update'],
  conditionalActions: []
})
export class RegionsAdminController {
  constructor(private readonly registry: RegionRegistryService) {}

  @Put(':region')
  @Authorize(['update', 'Region'])
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Open or close a region for new accounts'
  })
  @ApiParam({ name: 'region' })
  @ApiBody({ type: SetRegionStatusDto })
  @ApiOkResponse({ type: RegionStatusResponseDto })
  @ApiNotFoundResponse({ description: 'Region not found' })
  @ApiForbiddenResponse({ description: 'The home region cannot be closed' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  setStatus(
    @Param('region') region: string,
    @Body() dto: SetRegionStatusDto,
    @Req() req: JwtAuthRequest
  ): Promise<RegionStatusResponse> {
    return this.registry.setPublic(region, {
      isPublic: dto.public,
      actor: {
        actorId: req.user?.userId ?? null,
        actorEmail: req.user?.email ?? null,
        context: extractAuditContext(req)
      }
    });
  }
}
