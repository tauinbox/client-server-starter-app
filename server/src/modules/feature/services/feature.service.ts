import { Injectable, NotFoundException } from '@nestjs/common';
import { FeatureEntityDto } from '../dto/feature-entity.dto';
import { plainToInstance } from 'class-transformer';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FeatureEntity } from '../entity/feature.entity';
import { Repository } from 'typeorm';
import { FeatureEntityCreateDto } from '../dto/feature-entity-create.dto';
import { FeatureEntityUpdateDto } from '../dto/feature-entity-update.dto';

@Injectable()
export class FeatureService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(FeatureEntity)
    private readonly featureEntityRepository: Repository<FeatureEntity>,
  ) {}

  getDescription(): string {
    return 'Hello World!';
  }

  getConfigParams() {
    const { api, token } = this.configService.get('externalProject');
    return { api, token };
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

  async createEntity(entity: FeatureEntityCreateDto): Promise<{ id: number }> {
    const featureEntity = new FeatureEntity();
    featureEntity.name = entity.name;

    const { id } = await this.featureEntityRepository.save(featureEntity);

    return { id };
  }

  async getEntityById(id: number): Promise<FeatureEntityDto> {
    const entity = await this.featureEntityRepository.findOneBy({ id });

    if (!entity) {
      throw new NotFoundException(`Unable to find entity with id=[${id}]`);
    }

    return plainToInstance(FeatureEntityDto, entity);
  }

  async updateEntity(
    id: number,
    changes: FeatureEntityUpdateDto,
  ): Promise<FeatureEntityDto> {
    let entity = await this.featureEntityRepository.findOneBy({ id });

    if (!entity) {
      throw new NotFoundException(`Unable to find entity with id=[${id}]`);
    }

    entity = await this.featureEntityRepository.save({ ...entity, ...changes });
    return plainToInstance(FeatureEntityDto, entity);
  }

  async deleteEntity(id: number): Promise<void> {
    await this.featureEntityRepository.delete(id);
  }
}
