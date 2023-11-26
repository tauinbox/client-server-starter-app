import { Injectable, NotFoundException } from '@nestjs/common';
import { FeatureEntityDto } from '../dto/feature-entity.dto';
import { plainToInstance } from 'class-transformer';
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
    private readonly featureEntityRepository: Repository<FeatureEntity>,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  getConfigParams() {
    const { api, token } = this.configService.get('externalProject');
    return `External API url: ${api}, Token: ${token}`;
  }

  async getEntities(searchTerm?: string): Promise<FeatureEntityDto[]> {
    const result = searchTerm
      ? await this.featureEntityRepository
          .createQueryBuilder('featureEntity')
          .where('featureEntity.name like :searchTerm', {
            searchTerm: `%${searchTerm}%`,
          })
          .getMany()
      : await this.featureEntityRepository.find();
    return plainToInstance(FeatureEntityDto, result);
  }

  async getEntityById(id: number): Promise<FeatureEntityDto> {
    const result = await this.featureEntityRepository.findOneBy({ id });
    if (!result)
      throw new NotFoundException(`Unable to find entity with id=[${id}]`);
    return plainToInstance(FeatureEntityDto, result);
  }

  async createFeatureEntity(f: FeatureEntityInterface) {
    const featureEntity = new FeatureEntity();
    featureEntity.name = f.name;
    await this.featureEntityRepository.save(featureEntity);
  }
}
