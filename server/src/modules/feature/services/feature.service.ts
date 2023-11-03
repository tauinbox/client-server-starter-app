import { Injectable, NotFoundException } from '@nestjs/common';
import { FeatureEntityDto } from '../dto/feature-entity.dto';
import { plainToInstance } from 'class-transformer';
import { featureEntities } from '../const/data';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FeatureEntity } from '../entity/feature.entity';
import { Repository } from 'typeorm';
import { FeatureEntityInterface } from '../interfaces/feature-entity.interface';

@Injectable()
export class FeatureService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(FeatureEntity)
    private readonly featuresRepository: Repository<FeatureEntity>,
  ) {}

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

  async createFeature(f: FeatureEntityInterface) {
    const feature = new FeatureEntity();
    feature.id = f.id;
    feature.name = f.name;
    await this.featuresRepository.save(feature);
  }
}
