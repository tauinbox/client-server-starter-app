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
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes
} from '@nestjs/common';
import { FeatureService } from '../services/feature.service';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { FeatureEntityDto } from '../dtos/feature-entity.dto';
import { FeatureConfigDto } from '../dtos/feature-config.dto';
import { FeatureEntityCreateDto } from '../dtos/feature-entity-create.dto';
import { FeatureEntityUpdateDto } from '../dtos/feature-entity-update.dto';
import { NameValidatorPipe } from '../pipes/name-validator.pipe';
import { FeatureControllerGuard } from '../guards/feature-controller.guard';
import { FeatureMethodGuard } from '../guards/feature-method.guard';
import { FeatureRolesEnum } from '../enums/feature-roles.enum';
import { FeatureRoles } from '../decorators/feature-roles.decorator';
import { FeatureInterceptor } from '../interceptors/feature.interceptor';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import e from 'express';
import { FeatureUploadDto } from '../dtos/feature-upload.dto';

// We use Validation pipe globally in main.ts so it will apply to all the methods here

@ApiTags('Feature API')
@Controller({
  path: 'feature',
  version: '1'
})
@UseGuards(FeatureControllerGuard) // applies to all controller methods
export class FeatureController {
  constructor(private readonly featureService: FeatureService) {}

  @ApiOperation({ summary: 'Returns feature description' })
  @ApiOkResponse({
    type: String
  })
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain')
  @FeatureRoles(FeatureRolesEnum.User) // here is our custom Roles metadata decorator
  @Get()
  getHello(): string {
    return this.featureService.getDescription();
  }

  @ApiOperation({ summary: 'Returns feature config' })
  @ApiOkResponse({
    type: FeatureConfigDto
  })
  // we can access this metadata in a guard
  // @SetMetadata(MetadataKeysEnum.Roles, [RolesEnum.Admin]) // bad practice, the better way is to create a custom decorator
  @FeatureRoles(FeatureRolesEnum.Admin, FeatureRolesEnum.User) // here is our custom Roles metadata decorator
  @UseInterceptors(FeatureInterceptor) // Apply interceptor at the method level
  @Get('config')
  getConfigParams(): FeatureConfigDto {
    return this.featureService.getConfigParams();
  }

  @ApiOperation({ summary: 'Returns list of entities' })
  @ApiOkResponse({
    type: FeatureEntityDto,
    isArray: true
  })
  @ApiQuery({ name: 'searchTerm', required: false, type: String })
  @Get('entities')
  getEntities(
    @Query('searchTerm') searchTerm?: string
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
    type: FeatureEntityDto
  })
  @ApiNotFoundResponse({ description: 'Not found Error' })
  @Get('entities/:id')
  getEntity(@Param('id', ParseIntPipe) id: number): Promise<FeatureEntityDto> {
    return this.featureService.getEntityById(id);
  }

  @ApiOperation({ summary: 'Updates entity by ID' })
  @ApiOkResponse({
    type: FeatureEntityDto
  })
  @ApiNotFoundResponse({ description: 'Not found Error' })
  @Patch('entities/:id')
  updateEntity(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: FeatureEntityUpdateDto
  ): Promise<FeatureEntityDto> {
    return this.featureService.updateEntity(id, data);
  }

  @ApiOperation({ summary: 'Deletes entity by ID' })
  @ApiNotFoundResponse({ description: 'Not found Error' })
  @Delete('entities/:id')
  deleteEntity(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.featureService.deleteEntity(id);
  }

  @ApiOperation({ summary: 'Uploads file' })
  @UseInterceptors(
    // 'upload-artifact' is a name of attribute within received multipart/form-data containing the file data
    FileInterceptor('upload-artifact', {
      storage: diskStorage({
        destination: './public/uploads',
        filename(
          req: e.Request,
          file: Express.Multer.File,
          callback: (error: Error | null, filename: string) => void
        ) {
          callback(
            null,
            `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`
          );
        }
      })
    })
  )
  @Post('upload')
  upload(
    @Body() dto: FeatureUploadDto,
    @UploadedFile() file: Express.Multer.File
  ) {
    if (file) {
      dto.filename = file.filename;
      console.log('Stored file:', dto);
    }
  }
}
