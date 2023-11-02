import { Injectable, NotFoundException } from '@nestjs/common';
import { FeatureEntityDto } from '../dto/feature-entity.dto';
import { plainToInstance } from 'class-transformer';
import { featureEntities } from '../const/data';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FeatureService {
  constructor(private readonly configService: ConfigService) {}

  getHello(): string {
    return 'Hello World!';
  }

  getConfigParams() {
    const { api, token } = this.configService.get('myProject');
    return `API url: ${api}, Token: ${token}`;
  }

  getEntities(searchTerm?: string): FeatureEntityDto[] {
    const result = searchTerm
      ? featureEntities.filter((e) => e.name.includes(searchTerm))
      : featureEntities;
    return plainToInstance(FeatureEntityDto, result);
  }

  getEntityById(id: number): FeatureEntityDto {
    const result = featureEntities.find((e) => e.id === id);
    if (!result)
      throw new NotFoundException(`Unable to find entity with id=[${id}]`);
    return plainToInstance(FeatureEntityDto, result);
  }
}
