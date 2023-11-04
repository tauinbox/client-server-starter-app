import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { FeatureService } from '../services/feature.service';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FeatureEntityDto } from '../dto/feature-entity.dto';

@ApiTags('Feature API')
@Controller({
  path: 'feature',
  version: '1',
})
export class FeatureController {
  constructor(private readonly featureService: FeatureService) {}

  @ApiOperation({ summary: 'Returns Hello World!' })
  @ApiOkResponse({
    type: String,
  })
  @Get()
  getHello(): string {
    return this.featureService.getHello();
  }

  @ApiOperation({ summary: 'Returns Config Params' })
  @ApiOkResponse({
    type: String,
  })
  @Get('config')
  getConfigParams(): string {
    return this.featureService.getConfigParams();
  }

  @ApiOperation({ summary: 'Returns list of feature entities' })
  @ApiOkResponse({
    type: FeatureEntityDto,
    isArray: true,
  })
  @Get('entities')
  @ApiQuery({ name: 'searchTerm', required: false, type: String })
  getEntities(
    @Query('searchTerm') searchTerm?: string,
  ): Promise<FeatureEntityDto[]> {
    return this.featureService.getEntities(searchTerm);
  }

  @ApiOperation({ summary: 'Returns entity by ID' })
  @ApiOkResponse({
    type: FeatureEntityDto,
  })
  @ApiNotFoundResponse({ description: 'Not found Error' })
  @Get('entities/:id')
  getEntity(@Param('id', ParseIntPipe) id: number): Promise<FeatureEntityDto> {
    return this.featureService.getEntityById(id);
  }
}
