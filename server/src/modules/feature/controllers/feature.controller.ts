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
import { FeatureControllerGuard } from '../guards/feature-controller.guard';
import { FeatureMethodGuard } from '../guards/feature-method.guard';
import { RolesEnum } from '../enums/roles.enum';
import { Roles } from '../decorators/roles.decorator';

// We use Validation pipe globally in main.ts so it will apply to all the methods here

@ApiTags('Feature API')
@Controller({
  path: 'feature',
  version: '1',
})
@UseGuards(FeatureControllerGuard) // applies to all controller methods
export class FeatureController {
  constructor(private readonly featureService: FeatureService) {}

  @ApiOperation({ summary: 'Returns feature description' })
  @ApiOkResponse({
    type: String,
  })
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain')
  @Roles(RolesEnum.User) // here is our custom Roles metadata decorator
  @Get()
  getHello(): string {
    return this.featureService.getDescription();
  }

  @ApiOperation({ summary: 'Returns feature config' })
  @ApiOkResponse({
    type: FeatureConfigDto,
  })
  // we can access this metadata in a guard
  // @SetMetadata(MetadataKeysEnum.Roles, [RolesEnum.Admin]) // bad practice, the better way is to create a custom decorator
  @Roles(RolesEnum.Admin, RolesEnum.User) // here is our custom Roles metadata decorator
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
  @UseGuards(FeatureMethodGuard)
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
