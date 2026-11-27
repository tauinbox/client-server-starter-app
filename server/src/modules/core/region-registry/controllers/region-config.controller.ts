import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RegionConfigResponse } from '@app/shared/types';
import { Public } from '../../../auth/decorators/public.decorator';
import { RegionService } from '../../region/region.service';
import { RegionRegistryService } from '../region-registry.service';

@ApiTags('Config API')
@Controller({
  path: 'config/region',
  version: '1'
})
export class RegionConfigController {
  constructor(
    private readonly regionService: RegionService,
    private readonly registry: RegionRegistryService
  ) {}

  @Public()
  @Get()
  @ApiOperation({
    summary:
      'Get the data region of this deployment, the other regions and the public regions'
  })
  @ApiOkResponse({ description: 'Region, peer URLs and public regions' })
  async getRegion(): Promise<RegionConfigResponse> {
    return {
      ...this.regionService.config(),
      publicRegions: await this.registry.publicRegions()
    };
  }
}
