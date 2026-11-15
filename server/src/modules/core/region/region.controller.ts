import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RegionConfigResponse } from '@app/shared/types';
import { Public } from '../../auth/decorators/public.decorator';
import { RegionService } from './region.service';

@ApiTags('Config API')
@Controller({
  path: 'config/region',
  version: '1'
})
export class RegionController {
  constructor(private readonly regionService: RegionService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Get the data region of this deployment and the other regions'
  })
  @ApiOkResponse({ description: 'Region and peer URLs' })
  getRegion(): RegionConfigResponse {
    return this.regionService.config();
  }
}
