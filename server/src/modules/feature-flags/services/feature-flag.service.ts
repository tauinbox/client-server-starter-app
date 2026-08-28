import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, UpdateResult } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import type {
  FeatureFlagAttributeKeysResponse,
  FeatureFlagPreviewResult
} from '@app/shared/types';
import {
  previewFeatureFlag,
  type EvaluatorFlag,
  type EvaluatorRule,
  type FeatureFlagEvaluationContext
} from '@app/shared/utils/feature-flag-evaluator';
import { CursorPaginatedResponseDto } from '../../../common/dtos';
import type { FeatureFlagCursorQueryDto } from '../../../common/dtos';
import { applyKeysetPagination } from '../../../common/utils/apply-keyset-pagination.util';
import { isUniqueViolation } from '../../../common/utils/is-unique-violation.util';
import { FeatureFlag } from '../entities/feature-flag.entity';
import { FeatureFlagRule } from '../entities/feature-flag-rule.entity';

const FEATURE_FLAG_SORT_COLUMN_MAP: Record<string, string> = {
  createdAt: 'flag.createdAt',
  key: 'flag.key'
};
import { CreateFeatureFlagDto } from '../dtos/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from '../dtos/update-feature-flag.dto';
import { FeatureFlagRuleDto } from '../dtos/feature-flag-rule.dto';
import {
  PreviewFlagContextDto,
  sanitizeAttributes
} from '../dtos/preview-flag-context.dto';
import { validateRulePayload } from '../utils/validate-rule-payload.util';
import { AttributeRegistryService } from './attribute-registry.service';

function keyExistsConflict(): HttpException {
  return new HttpException(
    {
      message: 'Feature flag with this key already exists',
      errorKey: ErrorKeys.FEATURE_FLAGS.KEY_EXISTS
    },
    HttpStatus.CONFLICT
  );
}

@Injectable()
export class FeatureFlagService {
  constructor(
    @InjectRepository(FeatureFlag)
    private readonly flagRepo: Repository<FeatureFlag>,
    @InjectRepository(FeatureFlagRule)
    private readonly ruleRepo: Repository<FeatureFlagRule>,
    private readonly dataSource: DataSource,
    private readonly attributeRegistry: AttributeRegistryService,
    private readonly configService: ConfigService
  ) {}

  /**
   * The `custom` attribute keys a rule payload may reference. The registry is
   * filled from `onModuleInit` registrars, so this reports a runtime fact that
   * no shared constant could hold. Keys only: `resolveAll` evaluates the same
   * registry against a user, and those values carry personal data.
   */
  getAttributeCustomKeys(): FeatureFlagAttributeKeysResponse {
    return {
      customKeys: [...this.attributeRegistry.getKnownCustomKeys()].sort()
    };
  }

  async findAll(): Promise<FeatureFlag[]> {
    const flags = await this.flagRepo.find({ order: { key: 'ASC' } });
    await this.#attachRules(flags);
    return flags;
  }

  /**
   * Cursor-paginated flags for the admin list page, each with its rules
   * hydrated exactly as findAll does. findAll stays for the callers that need
   * the whole set in one shot (cache warm-up, evaluation).
   */
  async findCursorPaginated(
    query: FeatureFlagCursorQueryDto
  ): Promise<CursorPaginatedResponseDto<FeatureFlag>> {
    const { cursor, limit, sortBy, sortOrder } = query;
    const { data, nextCursor } = await applyKeysetPagination(
      this.flagRepo.createQueryBuilder('flag'),
      {
        cursor,
        limit,
        sortBy,
        sortOrder,
        sortColumnMap: FEATURE_FLAG_SORT_COLUMN_MAP,
        idColumn: 'flag.id'
      }
    );
    await this.#attachRules(data);
    return new CursorPaginatedResponseDto(data, nextCursor, limit);
  }

  /** Loads every rule of the given flags in one query and attaches them. */
  async #attachRules(flags: FeatureFlag[]): Promise<void> {
    if (flags.length === 0) return;
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
  }

  /**
   * Single-flag lookup by unique key (no rules loaded). Returns null when the
   * key is absent. Used by hot-path admin toggles that only read `enabled`.
   *
   * NOT an access evaluation: the raw `enabled` column ignores environments and
   * every targeting rule, so a caller acting on it grants access the evaluator
   * would deny. Only safe for fail-closed kill switches that treat "not enabled"
   * as off for everyone - see `BillingService.isProviderEnabled`. Anything
   * user-facing must go through `FeatureFlagResolverService`.
   */
  async findByKey(key: string): Promise<FeatureFlag | null> {
    return this.flagRepo.findOne({ where: { key } });
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
      throw keyExistsConflict();
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
    // The check above races a concurrent create against UQ_feature_flags_key.
    // The loser gets a unique violation, which the global filter would report
    // as a generic conflict - map it to the flag-specific key instead.
    let saved: FeatureFlag;
    try {
      saved = await this.flagRepo.save(flag);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw keyExistsConflict();
      throw error;
    }
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
        throw keyExistsConflict();
      }
    }
    const qb = this.flagRepo
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
      });

    // Same race as in create(): a concurrent writer may take the key between
    // the check above and this statement.
    let result: UpdateResult;
    try {
      result = await qb.execute();
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw keyExistsConflict();
      throw error;
    }

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
    const result = await this.flagRepo
      .createQueryBuilder()
      .update(FeatureFlag)
      .set({
        enabled: () => 'NOT enabled',
        updatedByUserId: actorId,
        version: () => `version + 1`
      })
      .where('id = :id', { id })
      .execute();
    if (result.affected === 0) {
      throw new NotFoundException({
        message: 'Feature flag not found',
        errorKey: ErrorKeys.FEATURE_FLAGS.NOT_FOUND
      });
    }
    return this.findOne(id);
  }

  async delete(id: string): Promise<void> {
    const flag = await this.findOne(id);
    await this.flagRepo.remove(flag);
  }

  async preview(
    id: string,
    dto: PreviewFlagContextDto
  ): Promise<FeatureFlagPreviewResult> {
    const flag = await this.findOne(id);
    const evalFlag: EvaluatorFlag = {
      key: flag.key,
      enabled: dto.enabled ?? flag.enabled,
      environments: dto.environments ?? flag.environments
    };
    // A supplied rule set goes through the same validator the save path uses,
    // so preview never accepts a payload `PUT /:id/rules` would reject.
    const customKeys = this.attributeRegistry.getKnownCustomKeys();
    const evalRules: EvaluatorRule[] = dto.rules
      ? dto.rules.map((r) => ({
          effect: r.effect,
          payload: validateRulePayload(r.type, r.payload, customKeys)
        }))
      : flag.rules.map((r) => ({
          effect: r.effect,
          payload: r.payload
        }));
    const env =
      dto.env ?? this.configService.get<string>('ENVIRONMENT') ?? 'production';
    const ctx: FeatureFlagEvaluationContext = {
      userId: dto.userId ?? null,
      anonId: dto.anonId ?? null,
      roles: dto.roles ?? [],
      attributes: sanitizeAttributes(dto.attributes),
      env
    };
    return previewFeatureFlag(evalFlag, evalRules, ctx);
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
