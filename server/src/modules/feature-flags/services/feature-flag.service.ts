import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import { FeatureFlag } from '../entities/feature-flag.entity';
import { FeatureFlagRule } from '../entities/feature-flag-rule.entity';
import { CreateFeatureFlagDto } from '../dtos/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from '../dtos/update-feature-flag.dto';
import { FeatureFlagRuleDto } from '../dtos/feature-flag-rule.dto';
import { validateRulePayload } from '../utils/validate-rule-payload.util';
import { AttributeRegistryService } from './attribute-registry.service';

@Injectable()
export class FeatureFlagService {
  constructor(
    @InjectRepository(FeatureFlag)
    private readonly flagRepo: Repository<FeatureFlag>,
    @InjectRepository(FeatureFlagRule)
    private readonly ruleRepo: Repository<FeatureFlagRule>,
    private readonly dataSource: DataSource,
    private readonly attributeRegistry: AttributeRegistryService
  ) {}

  async findAll(): Promise<FeatureFlag[]> {
    const flags = await this.flagRepo.find({ order: { key: 'ASC' } });
    if (flags.length === 0) return flags;
    const rules = await this.ruleRepo.find({
      where: { flagId: In(flags.map((f) => f.id)) },
      order: { createdAt: 'ASC', id: 'ASC' }
    });
    const byFlag = new Map<string, FeatureFlagRule[]>();
    for (const r of rules) {
      const list = byFlag.get(r.flagId) ?? [];
      list.push(r);
      byFlag.set(r.flagId, list);
    }
    for (const f of flags) f.rules = byFlag.get(f.id) ?? [];
    return flags;
  }

  async findOne(id: string): Promise<FeatureFlag> {
    const flag = await this.flagRepo.findOne({ where: { id } });
    if (!flag) {
      throw new NotFoundException({
        message: 'Feature flag not found',
        errorKey: ErrorKeys.FEATURE_FLAGS.NOT_FOUND
      });
    }
    flag.rules = await this.ruleRepo.find({
      where: { flagId: id },
      order: { createdAt: 'ASC', id: 'ASC' }
    });
    return flag;
  }

  async create(
    dto: CreateFeatureFlagDto,
    actorId: string | null
  ): Promise<FeatureFlag> {
    const existing = await this.flagRepo.findOne({ where: { key: dto.key } });
    if (existing) {
      throw new HttpException(
        {
          message: 'Feature flag with this key already exists',
          errorKey: ErrorKeys.FEATURE_FLAGS.KEY_EXISTS
        },
        HttpStatus.CONFLICT
      );
    }
    const flag = this.flagRepo.create({
      key: dto.key,
      description: dto.description ?? null,
      enabled: dto.enabled ?? false,
      environments: dto.environments ?? [],
      public: dto.public ?? false,
      version: 1,
      updatedByUserId: actorId
    });
    const saved = await this.flagRepo.save(flag);
    return this.findOne(saved.id);
  }

  async update(
    id: string,
    dto: UpdateFeatureFlagDto,
    expectedVersion: number,
    actorId: string | null
  ): Promise<FeatureFlag> {
    await this.findOne(id);
    if (dto.key !== undefined) {
      const conflict = await this.flagRepo.findOne({ where: { key: dto.key } });
      if (conflict && conflict.id !== id) {
        throw new HttpException(
          {
            message: 'Feature flag with this key already exists',
            errorKey: ErrorKeys.FEATURE_FLAGS.KEY_EXISTS
          },
          HttpStatus.CONFLICT
        );
      }
    }
    const result = await this.flagRepo
      .createQueryBuilder()
      .update(FeatureFlag)
      .set({
        ...(dto.key !== undefined ? { key: dto.key } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.environments !== undefined
          ? { environments: dto.environments }
          : {}),
        ...(dto.public !== undefined ? { public: dto.public } : {}),
        updatedByUserId: actorId,
        version: () => `version + 1`
      })
      .where('id = :id AND version = :expected', {
        id,
        expected: expectedVersion
      })
      .execute();

    if (result.affected === 0) {
      throw new HttpException(
        {
          message:
            'Feature flag was modified by another request — reload and retry',
          errorKey: ErrorKeys.FEATURE_FLAGS.VERSION_CONFLICT
        },
        HttpStatus.CONFLICT
      );
    }
    return this.findOne(id);
  }

  async toggle(id: string, actorId: string | null): Promise<FeatureFlag> {
    const flag = await this.findOne(id);
    await this.flagRepo.update(id, {
      enabled: !flag.enabled,
      updatedByUserId: actorId,
      version: flag.version + 1
    });
    return this.findOne(id);
  }

  async delete(id: string): Promise<void> {
    const flag = await this.findOne(id);
    await this.flagRepo.remove(flag);
  }

  async replaceRules(
    id: string,
    rules: FeatureFlagRuleDto[],
    actorId: string | null
  ): Promise<FeatureFlag> {
    await this.findOne(id);
    const customKeys = this.attributeRegistry.getKnownCustomKeys();
    const validatedPayloads = rules.map((r) =>
      validateRulePayload(r.type, r.payload, customKeys)
    );

    await this.dataSource.transaction(async (em) => {
      await em.delete(FeatureFlagRule, { flagId: id });
      if (rules.length > 0) {
        // Insert sequentially so clock_timestamp() advances per row and
        // preserves request-array order via the created_at column.
        for (let i = 0; i < rules.length; i++) {
          const r = rules[i];
          const record = em.create(FeatureFlagRule, {
            flagId: id,
            type: r.type,
            effect: r.effect,
            payload: validatedPayloads[i]
          });
          await em.save(FeatureFlagRule, record);
        }
      }
      await em.update(
        FeatureFlag,
        { id },
        {
          updatedByUserId: actorId,
          version: () => `version + 1`
        }
      );
    });
    return this.findOne(id);
  }
}
