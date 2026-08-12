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
import { CursorPaginatedResponseDto } from '../../../common/dtos';
import type { ResourceCursorQueryDto } from '../../../common/dtos';
import { applyKeysetPagination } from '../../../common/utils/apply-keyset-pagination.util';
import { RESOURCE_SORT_COLUMN_MAP } from '../utils/rbac-sort-columns.util';
import { CASL_RESERVED_SUBJECT_NAMES } from '../casl/constants';
import { ErrorKeys } from '@app/shared/constants/error-keys';
import { ResourceRegistryService } from './resource-registry.service';
import { MetricsService } from '../../core/metrics/metrics.service';

// Key is versioned: the cached value's shape changed from a flat
// resource -> subject record to the split maps below, and a Redis entry
// written by a previous release outlives the deploy.
const SUBJECT_MAP_CACHE_KEY = 'rbac:subject_map:v2';
const SUBJECT_MAP_CACHE_TTL = 300_000; // 5 minutes

/**
 * Resource name -> CASL subject, split by orphan state.
 *
 * Only `active` may grant: an orphaned resource has lost the controller that
 * registered it, so nothing may be allowed on it. Denies resolve against
 * `orphaned` as a fallback so that removing a controller cannot quietly drop a
 * deny rule (see CaslAbilityFactory).
 */
export interface SubjectMaps {
  active: Record<string, string>;
  orphaned: Record<string, string>;
}

@Injectable()
export class ResourceService {
  private readonly logger = new Logger(ResourceService.name);

  constructor(
    @InjectRepository(Resource)
    private readonly resourceRepository: Repository<Resource>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache,
    private readonly registry: ResourceRegistryService,
    private readonly metrics: MetricsService
  ) {}

  /**
   * Cursor-paginated resources for the admin list page. The unpaginated
   * findAll below stays: the permissions matrix needs every resource at once.
   */
  async findCursorPaginated(
    query: ResourceCursorQueryDto
  ): Promise<CursorPaginatedResponseDto<Resource>> {
    const { cursor, limit, sortBy, sortOrder } = query;
    const { data, nextCursor } = await applyKeysetPagination(
      this.resourceRepository.createQueryBuilder('resource'),
      {
        cursor,
        limit,
        sortBy,
        sortOrder,
        sortColumnMap: RESOURCE_SORT_COLUMN_MAP,
        idColumn: 'resource.id'
      }
    );
    for (const resource of data) {
      resource.isRegistered = this.registry.isRegistered(resource.name);
    }
    return new CursorPaginatedResponseDto(data, nextCursor, limit);
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

  async findOne(id: string): Promise<Resource | null> {
    return this.resourceRepository.findOne({ where: { id } });
  }

  async update(
    id: string,
    data: {
      displayName?: string;
      description?: string | null;
      allowedActionNames?: string[] | null;
    }
  ): Promise<Resource> {
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
    Object.assign(resource, data);
    const saved = await this.resourceRepository.save(resource);
    await this.invalidateSubjectMapCache();
    return saved;
  }

  async getSubjectMaps(): Promise<SubjectMaps> {
    const cached = await this.cacheManager.get<SubjectMaps>(
      SUBJECT_MAP_CACHE_KEY
    );
    this.metrics.recordCacheAccess('resources', cached ? 'hit' : 'miss');
    if (cached) {
      return cached;
    }

    const resources = await this.resourceRepository.find();
    const maps: SubjectMaps = { active: {}, orphaned: {} };
    for (const r of resources) {
      if (r.isOrphaned) {
        maps.orphaned[r.name] = r.subject;
      } else {
        maps.active[r.name] = r.subject;
      }
    }

    await this.cacheManager.set(
      SUBJECT_MAP_CACHE_KEY,
      maps,
      SUBJECT_MAP_CACHE_TTL
    );
    return maps;
  }

  async restore(id: string): Promise<Resource> {
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
    if (!this.registry.isRegistered(resource.name)) {
      throw new HttpException(
        {
          message: `Cannot restore resource "${resource.name}": its @RegisterResource controller is not registered. Restore the controller code first.`,
          errorKey: ErrorKeys.RESOURCES.CANNOT_RESTORE
        },
        HttpStatus.BAD_REQUEST
      );
    }
    resource.isOrphaned = false;
    const saved = await this.resourceRepository.save(resource);
    await this.invalidateSubjectMapCache();
    saved.isRegistered = true;
    return saved;
  }

  async upsertResource(data: {
    name: string;
    subject: string;
    displayName: string;
    isSystem?: boolean;
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

    if (existing) {
      existing.subject = normalizedSubject;
      existing.displayName = data.displayName;
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
    await this.cacheManager.del(SUBJECT_MAP_CACHE_KEY);
  }
}
