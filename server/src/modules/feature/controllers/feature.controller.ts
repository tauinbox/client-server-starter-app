import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { FeatureService } from '../services/feature.service';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { FeatureEntityDto } from '../dtos/feature-entity.dto';
import { FeatureConfigDto } from '../dtos/feature-config.dto';
import { FeatureEntityCreateDto } from '../dtos/feature-entity-create.dto';
import { FeatureEntityUpdateDto } from '../dtos/feature-entity-update.dto';
import { NameValidatorPipe } from '../pipes/name-validator.pipe';
import { FeatureGuard } from '../guards/feature.guard';

// We use Validation pipe globally in main.ts so it will apply to all the methods here

@ApiTags('Feature API')
@Controller({
  path: 'feature',
  version: '1',
})
@UseGuards(FeatureGuard) // we can use guards at the controller level as well as on its methods
export class FeatureController {
  constructor(private readonly featureService: FeatureService) {}

  @ApiOperation({ summary: 'Returns feature description' })
  @ApiOkResponse({
    type: String,
  })
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain')
  @Get()
  getHello(): string {
    return this.featureService.getDescription();
  }

  @ApiOperation({ summary: 'Returns feature config' })
  @ApiOkResponse({
    type: FeatureConfigDto,
  })
  @Get('config')
  getConfigParams(): FeatureConfigDto {
    return this.featureService.getConfigParams();
  }

  @ApiOperation({ summary: 'Returns list of entities' })
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

  @ApiOperation({ summary: 'Creates new entity' })
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(NameValidatorPipe)
  @Post('entities')
  createEntity(@Body() data: FeatureEntityCreateDto): Promise<{ id: number }> {
    // we use @Body decorator here
    // so the NameValidatorPipe pipe will apply to its data
    return this.featureService.createEntity(data);
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

  @ApiOperation({ summary: 'Updates entity by ID' })
  @ApiOkResponse({
    type: FeatureEntityDto,
  })
  @Patch('entities/:id')
  updateEntity(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: FeatureEntityUpdateDto,
  ): Promise<FeatureEntityDto> {
    return this.featureService.updateEntity(id, data);
  }

  @ApiOperation({ summary: 'Deletes entity by ID' })
  @ApiNotFoundResponse({ description: 'Not found Error' })
  @Delete('entities/:id')
  deleteEntity(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.featureService.deleteEntity(id);
  }
}
