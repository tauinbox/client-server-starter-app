import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Resource } from '../entities/resource.entity';
import type {
  CursorPaginatedResponseDto,
  ResourceCursorQueryDto
} from '../../../common/dtos';
import { applyList } from '../../../common/utils/apply-list-query.util';
import { CacheVersionCounter } from '../../../common/utils/cache-version-counter';
import { RESOURCE_LIST_COLUMNS } from '../utils/rbac-sort-columns.util';
import {
  CASL_RESERVED_SUBJECT_NAMES,
  ErrorKeys,
  RESOURCE_LIST_QUERY
} from '@app/shared/constants';
import type { SubjectMaps } from '@app/shared/types';
import { ResourceRegistryService } from './resource-registry.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { AuditService } from '../../audit/audit.service';
import type { AuditLogParams } from '../../audit/audit.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import {
  changesGrantableActions,
  grantableActionNames,
  reofferedActionNames
} from '@app/shared/utils/grantable-actions';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ResourceActionsChangedEvent } from '../events/resource-actions-changed.event';
import { subject } from '@casl/ability';
import { withChanges } from '@app/shared/utils/changed-fields';
import { assertCan } from '../../../common/utils/assert-can.util';
import { refuseAccess } from '../../../common/utils/refuse-access.util';
import { auditContextOf } from '../casl/ability-context';
import { SYSTEM_ABILITY } from '../casl/app-ability';
import type { AbilityOrSystem } from '../casl/app-ability';

// Key is versioned: the cached value's shape changes between releases (a flat
// resource -> subject record, then the split maps, then conditionalActions),
// and a Redis entry written by a previous release outlives the deploy.
const SUBJECT_MAP_CACHE_KEY = 'rbac:subject_map:v3';
const SUBJECT_MAP_CACHE_TTL = 300_000; // 5 minutes
const SUBJECT_MAP_VERSION_KEY = 'rbac:subject_map:version';
const SUBJECT_MAP_VERSION_COUNTER_KEY = 'rbac:subject_map:version:counter';

@Injectable()
export class ResourceService {
  private readonly logger = new Logger(ResourceService.name);
  readonly #subjectMapVersion: CacheVersionCounter;

  constructor(
    @InjectRepository(Resource)
    private readonly resourceRepository: Repository<Resource>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly registry: ResourceRegistryService,
    private readonly metrics: MetricsService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2
  ) {
    this.#subjectMapVersion = new CacheVersionCounter(
      cacheManager,
      SUBJECT_MAP_VERSION_COUNTER_KEY,
      SUBJECT_MAP_VERSION_KEY,
      this.logger
    );
  }

  /**
   * Cursor-paginated resources for the admin list page. The unpaginated
   * findAll below stays: the permissions matrix needs every resource at once.
   */
  async findCursorPaginated(
    query: ResourceCursorQueryDto
  ): Promise<CursorPaginatedResponseDto<Resource>> {
    const page = await applyList(
      this.resourceRepository.createQueryBuilder('resource'),
      RESOURCE_LIST_QUERY,
      RESOURCE_LIST_COLUMNS,
      query
    );
    for (const resource of page.data) {
      resource.isRegistered = this.registry.isRegistered(resource.name);
    }
    return page;
  }

  async findAll(): Promise<Resource[]> {
    const resources = await this.resourceRepository.find({
      order: { name: 'ASC' }
    });
    return resources.map((r) => {
      r.isRegistered = this.registry.isRegistered(r.name);
      return r;
    });
  }

  private async loadResource(id: string): Promise<Resource> {
    const resource = await this.resourceRepository.findOne({ where: { id } });
    if (!resource) {
      throw new HttpException(
        {
          message: 'Resource not found',
          errorKey: ErrorKeys.RESOURCES.NOT_FOUND
        },
        HttpStatus.NOT_FOUND
      );
    }
    return resource;
  }

  /**
   * The route-level @Authorize check is type-level and ignores conditions, so
   * a conditional `update:Permission` grant is re-evaluated against the record.
   */
  private assertCanUpdate(
    ability: AbilityOrSystem,
    record: Partial<Resource>,
    actorId?: string
  ): void {
    if (ability === SYSTEM_ABILITY) return;
    assertCan(
      ability,
      'update',
      subject('Permission', record),
      this.auditService,
      { actorId, targetId: record.id, targetType: 'Resource' },
      this.metrics
    );
  }

  /** `audit` gets the resource as it is before the write. */
  async update(
    id: string,
    data: {
      displayName?: string;
      description?: string | null;
      allowedActionNames?: string[] | null;
    },
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: (before: Resource) => AuditLogParams
  ): Promise<Resource> {
    const resource = await this.loadResource(id);
    // The record after the write is checked too: else a grant scoped by a
    // writable field lets the caller move a resource out of its own scope.
    for (const record of [resource, withChanges(resource, data)]) {
      this.assertCanUpdate(ability, record, actorId);
    }
    const undeclared = (data.allowedActionNames ?? []).filter(
      (name) => !resource.actionNames.includes(name)
    );
    if (undeclared.length > 0) {
      throw new HttpException(
        {
          message: `Resource "${resource.name}" does not check the actions: ${undeclared.join(', ')}`,
          errorKey: ErrorKeys.RESOURCES.ACTION_NOT_DECLARED
        },
        HttpStatus.BAD_REQUEST
      );
    }
    if (data.allowedActionNames !== undefined) {
      this.assertCanWiden(
        ability,
        resource,
        reofferedActionNames(resource, data.allowedActionNames),
        actorId
      );
    }
    const grantsChange =
      data.allowedActionNames !== undefined &&
      changesGrantableActions(resource, data.allowedActionNames);
    const auditRow = audit?.({ ...resource });
    Object.assign(resource, data);
    const saved = await this.saveAudited(resource, auditRow);
    await this.invalidateSubjectMapCache();
    if (grantsChange) this.#emitActionsChanged();
    return saved;
  }

  /**
   * Narrowing or orphaning a resource keeps the role rows of its actions, so
   * offering an action again wakes every dormant grant of it, in every role.
   * Only a super caller may do that: buildAbility registers no allow on a
   * dormant action, so no other caller holds what the write would grant.
   */
  private assertCanWiden(
    ability: AbilityOrSystem,
    resource: Resource,
    reEnabled: string[],
    actorId?: string
  ): void {
    if (
      reEnabled.length === 0 ||
      ability === SYSTEM_ABILITY ||
      ability.can('manage', 'all')
    ) {
      return;
    }
    refuseAccess(
      this.auditService,
      this.metrics,
      {
        auditAction: AuditAction.PERMISSION_GRANT_DENIED,
        actorId,
        targetId: resource.id,
        targetType: 'Resource',
        details: {
          subject: resource.subject,
          actions: reEnabled,
          reason: 'resource-widen'
        },
        context: auditContextOf(ability),
        level: 'instance',
        denied: [{ action: reEnabled[0], subject: resource.subject }]
      },
      new HttpException(
        {
          message: `Only a super administrator can offer the actions ${reEnabled.join(', ')} of resource "${resource.name}" again`,
          errorKey: ErrorKeys.RESOURCES.CANNOT_WIDEN
        },
        HttpStatus.FORBIDDEN
      )
    );
  }

  /** Saves the resource and the audit row of the change in one transaction. */
  private saveAudited(
    resource: Resource,
    audit?: AuditLogParams
  ): Promise<Resource> {
    return this.resourceRepository.manager.transaction(async (em) => {
      const saved = await em.save(resource);
      if (audit) await this.auditService.log(audit, em);
      return saved;
    });
  }

  async getSubjectMaps(): Promise<SubjectMaps> {
    const version = await this.#subjectMapVersion.read();
    const cacheKey = `${SUBJECT_MAP_CACHE_KEY}:v${version}`;
    const cached = await this.cacheManager.get<SubjectMaps>(cacheKey);
    this.metrics.recordCacheAccess('resources', cached ? 'hit' : 'miss');
    if (cached) {
      return cached;
    }

    const resources = await this.resourceRepository.find();
    const maps: SubjectMaps = {
      active: {},
      orphaned: {},
      grantableActions: {},
      conditionalActions: {}
    };
    for (const r of resources) {
      maps.grantableActions[r.name] = grantableActionNames(r);
      maps.conditionalActions[r.name] = r.conditionalActionNames;
      if (r.isOrphaned) {
        maps.orphaned[r.name] = r.subject;
      } else {
        maps.active[r.name] = r.subject;
      }
    }

    await this.cacheManager.set(cacheKey, maps, SUBJECT_MAP_CACHE_TTL);
    return maps;
  }

  async restore(
    id: string,
    ability: AbilityOrSystem,
    actorId?: string,
    audit?: AuditLogParams
  ): Promise<Resource> {
    const resource = await this.loadResource(id);
    this.assertCanUpdate(ability, resource, actorId);
    if (!this.registry.isRegistered(resource.name)) {
      throw new HttpException(
        {
          message: `Cannot restore resource "${resource.name}": its @RegisterResource controller is not registered. Restore the controller code first.`,
          errorKey: ErrorKeys.RESOURCES.CANNOT_RESTORE
        },
        HttpStatus.BAD_REQUEST
      );
    }
    const woken = resource.isOrphaned ? grantableActionNames(resource) : [];
    this.assertCanWiden(ability, resource, woken, actorId);
    resource.isOrphaned = false;
    const saved = await this.saveAudited(resource, audit);
    await this.invalidateSubjectMapCache();
    if (woken.length > 0) this.#emitActionsChanged();
    saved.isRegistered = true;
    return saved;
  }

  #emitActionsChanged(): void {
    this.eventEmitter.emit(
      ResourceActionsChangedEvent.name,
      new ResourceActionsChangedEvent()
    );
  }

  async upsertResource(data: {
    name: string;
    subject: string;
    displayName: string;
    description: string;
    isSystem?: boolean;
    actionNames: string[];
    conditionalActionNames: string[];
  }): Promise<Resource> {
    // Normalize to PascalCase: CASL subjects are case-sensitive, so 'user' ≠ 'User'
    const normalizedSubject =
      data.subject.charAt(0).toUpperCase() + data.subject.slice(1);

    if (CASL_RESERVED_SUBJECT_NAMES.includes(normalizedSubject.toLowerCase())) {
      throw new HttpException(
        {
          message: `Resource subject "${normalizedSubject}" is reserved and cannot be used`,
          errorKey: ErrorKeys.RESOURCES.SUBJECT_RESERVED
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const existing = await this.resourceRepository.findOne({
      where: { name: data.name }
    });

    // The declared action lists belong to the code and are rewritten on every
    // sync. allowedActionNames is the admin's narrowing and is kept.
    if (existing) {
      existing.subject = normalizedSubject;
      existing.displayName = data.displayName;
      existing.description ??= data.description;
      existing.actionNames = data.actionNames;
      existing.conditionalActionNames = data.conditionalActionNames;
      existing.lastSyncedAt = new Date();
      return this.resourceRepository.save(existing);
    }

    const resource = this.resourceRepository.create({
      ...data,
      subject: normalizedSubject,
      isSystem: data.isSystem ?? false,
      lastSyncedAt: new Date()
    });
    return this.resourceRepository.save(resource);
  }

  async invalidateSubjectMapCache(): Promise<void> {
    await this.#subjectMapVersion.bump();
  }
}
