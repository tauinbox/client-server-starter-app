import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ErrorKeys, FEATURE_FLAG_LIST_QUERY } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { changedFields } from '@app/shared/utils/changed-fields';
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
import type {
  CursorPaginatedResponseDto,
  FeatureFlagCursorQueryDto
} from '../../../common/dtos';
import {
  applyList,
  type ListColumns
} from '../../../common/utils/apply-list-query.util';
import { isUniqueViolation } from '../../../common/utils/is-unique-violation.util';
import { applyAbilityToFeatureFlagQuery } from '../../../common/utils/apply-ability.util';
import type { AppAbility } from '../../auth/casl/app-ability';
import { AuditService } from '../../audit/audit.service';
import type { AuditContext } from '../../audit/audit.service';
import { FeatureFlag } from '../entities/feature-flag.entity';
import { FeatureFlagRule } from '../entities/feature-flag-rule.entity';

import { CreateFeatureFlagDto } from '../dtos/create-feature-flag.dto';
import { UpdateFeatureFlagDto } from '../dtos/update-feature-flag.dto';
import { FeatureFlagRuleDto } from '../dtos/feature-flag-rule.dto';
import { PreviewFlagContextDto } from '../dtos/preview-flag-context.dto';
import { validateRulePayload } from '../utils/validate-rule-payload.util';

const FEATURE_FLAG_LIST_COLUMNS: ListColumns<typeof FEATURE_FLAG_LIST_QUERY> = {
  search: { key: 'flag.key', description: 'flag.description' },
  filters: {
    enabled: 'flag.enabled',
    public: 'flag.public',
    environment: 'flag.environments'
  },
  sort: { createdAt: 'flag.createdAt', key: 'flag.key' },
  id: 'flag.id'
};
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

/** The actor of a flag write, as its audit row records it. */
export interface FlagAuditActor {
  actorId: string | null;
  actorEmail: string | null;
  context: AuditContext;
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
    private readonly configService: ConfigService,
    private readonly auditService: AuditService
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

  /**
   * Cursor-paginated flags for the admin list page, each with its rules
   * hydrated exactly as findOne does. The ability filter is SQL, so the
   * keyset pages stay complete.
   */
  async findCursorPaginated(
    query: FeatureFlagCursorQueryDto,
    ability: AppAbility
  ): Promise<CursorPaginatedResponseDto<FeatureFlag>> {
    const qb = this.flagRepo.createQueryBuilder('flag');
    applyAbilityToFeatureFlagQuery(qb, ability, 'search');
    const page = await applyList(
      qb,
      FEATURE_FLAG_LIST_QUERY,
      FEATURE_FLAG_LIST_COLUMNS,
      query
    );
    await this.#attachRules(page.data);
    return page;
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

  /** The fields of a new flag as `create` writes them, defaults included. */
  newFlagFields(dto: CreateFeatureFlagDto) {
    return {
      key: dto.key,
      description: dto.description ?? null,
      enabled: dto.enabled ?? false,
      environments: dto.environments ?? [],
      public: dto.public ?? false
    };
  }

  async create(
    dto: CreateFeatureFlagDto,
    actor: FlagAuditActor
  ): Promise<FeatureFlag> {
    const existing = await this.flagRepo.findOne({ where: { key: dto.key } });
    if (existing) {
      throw keyExistsConflict();
    }
    const rules = this.#validateRules(dto.rules);
    // The check above races a concurrent create against UQ_feature_flags_key.
    // The loser gets a unique violation, which the global filter would report
    // as a generic conflict - map it to the flag-specific key instead.
    let saved: FeatureFlag;
    try {
      saved = await this.dataSource.transaction(async (em) => {
        const flag = await em.save(
          FeatureFlag,
          em.create(FeatureFlag, {
            ...this.newFlagFields(dto),
            version: 1,
            updatedByUserId: actor.actorId
          })
        );
        if (rules) await this.#writeRules(em, flag.id, rules);
        await this.#audit(em, actor, AuditAction.FEATURE_FLAG_CREATE, flag.id, {
          key: flag.key,
          flagId: flag.id,
          ...(rules ? { ruleCount: rules.length } : {})
        });
        return flag;
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) throw keyExistsConflict();
      throw error;
    }
    return this.findOne(saved.id);
  }

  async update(
    current: FeatureFlag,
    dto: UpdateFeatureFlagDto,
    expectedVersion: number,
    actor: FlagAuditActor
  ): Promise<FeatureFlag> {
    // The update is conditional on the version, so when it succeeds `current`
    // is exactly the state that it replaced. The rules are reported as a
    // count: rule rows and rule DTOs do not compare field by field.
    const { id } = current;
    const { rules: ruleDtos, ...fields } = dto;
    const rules = this.#validateRules(ruleDtos);
    await this.dataSource.transaction(async (em) => {
      const result = await em
        .createQueryBuilder()
        .update(FeatureFlag)
        .set({
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
          ...(dto.environments !== undefined
            ? { environments: dto.environments }
            : {}),
          ...(dto.public !== undefined ? { public: dto.public } : {}),
          updatedByUserId: actor.actorId,
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
      if (rules) await this.#writeRules(em, id, rules);
      await this.#audit(em, actor, AuditAction.FEATURE_FLAG_UPDATE, id, {
        changedFields: changedFields(current, fields),
        ...(rules ? { ruleCount: rules.length } : {})
      });
    });
    return this.findOne(id);
  }

  async delete(flag: FeatureFlag, actor: FlagAuditActor): Promise<void> {
    // The row is gone after the delete, so the key is recorded: a bare
    // targetId resolves to nothing once the flag no longer exists.
    const { id, key } = flag;
    await this.dataSource.transaction(async (em) => {
      await em.remove(FeatureFlag, flag);
      await this.#audit(em, actor, AuditAction.FEATURE_FLAG_DELETE, id, {
        key
      });
    });
  }

  /**
   * Writes the audit row through the transaction of the change, so a change
   * never commits without its row and a failed row rolls the change back.
   */
  #audit(
    em: EntityManager,
    actor: FlagAuditActor,
    action: AuditAction,
    flagId: string,
    details: Record<string, unknown>
  ): Promise<void> {
    return this.auditService.log(
      {
        action,
        actorId: actor.actorId,
        actorEmail: actor.actorEmail,
        targetId: flagId,
        targetType: 'FeatureFlag',
        details,
        context: actor.context
      },
      em
    );
  }

  preview(
    flag: FeatureFlag,
    dto: PreviewFlagContextDto
  ): FeatureFlagPreviewResult {
    const evalFlag: EvaluatorFlag = {
      key: flag.key,
      enabled: dto.enabled ?? flag.enabled,
      environments: dto.environments ?? flag.environments
    };
    // A supplied rule set goes through the same validator the save path uses,
    // so preview never accepts a payload that a save would reject.
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
      attributes: dto.attributes ?? {},
      env
    };
    return previewFeatureFlag(evalFlag, evalRules, ctx);
  }

  /**
   * Runs every rule payload through the rule-payload validator before the
   * transaction opens, so a rejected rule writes nothing.
   */
  #validateRules(
    rules: FeatureFlagRuleDto[] | undefined
  ): FeatureFlagRuleDto[] | undefined {
    if (!rules) return undefined;
    const customKeys = this.attributeRegistry.getKnownCustomKeys();
    return rules.map((r) => ({
      type: r.type,
      effect: r.effect,
      payload: validateRulePayload(r.type, r.payload, customKeys)
    }));
  }

  async #writeRules(
    em: EntityManager,
    flagId: string,
    rules: FeatureFlagRuleDto[]
  ): Promise<void> {
    await em.delete(FeatureFlagRule, { flagId });
    // Insert sequentially so clock_timestamp() advances per row and
    // preserves request-array order via the created_at column.
    for (const r of rules) {
      await em.save(
        FeatureFlagRule,
        em.create(FeatureFlagRule, {
          flagId,
          type: r.type,
          effect: r.effect,
          payload: r.payload
        })
      );
    }
  }

  /**
   * Replaces a role name in every role rule, or removes it when `newName` is
   * null, through the caller's transaction. The order of the names is kept and
   * a duplicate is dropped. Returns the keys of the flags whose rules changed;
   * each of them gets a new version so an open editor cannot save the old
   * names back.
   */
  async rewriteRoleName(
    em: EntityManager,
    oldName: string,
    newName: string | null
  ): Promise<string[]> {
    const rules = await em
      .createQueryBuilder()
      .update(FeatureFlagRule)
      .set({
        payload: () => `jsonb_set(payload, '{roleNames}', (
            SELECT COALESCE(jsonb_agg(n ORDER BY i), '[]'::jsonb)
            FROM (
              SELECT n, MIN(i) AS i
              FROM (
                SELECT CASE WHEN v = :oldName THEN :newName ELSE v END AS n, i
                FROM jsonb_array_elements_text(payload->'roleNames')
                  WITH ORDINALITY AS e(v, i)
              ) mapped
              WHERE n IS NOT NULL
              GROUP BY n
            ) deduped
          ))`
      })
      .where(`type = 'role' AND payload->'roleNames' ? :oldName`)
      .setParameters({ oldName, newName })
      .returning('flag_id')
      .execute();
    const flagIds = [
      ...new Set((rules.raw as { flag_id: string }[]).map((r) => r.flag_id))
    ];
    if (flagIds.length === 0) return [];
    const flags = await em
      .createQueryBuilder()
      .update(FeatureFlag)
      .set({ version: () => `version + 1` })
      .whereInIds(flagIds)
      .returning('key')
      .execute();
    return (flags.raw as { key: string }[]).map((f) => f.key);
  }
}
