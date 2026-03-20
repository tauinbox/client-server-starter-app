import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Resource } from '../entities/resource.entity';

const SUBJECT_MAP_CACHE_KEY = 'rbac:subject_map';
const SUBJECT_MAP_CACHE_TTL = 300_000; // 5 minutes

@Injectable()
export class ResourceService {
  private readonly logger = new Logger(ResourceService.name);

  constructor(
    @InjectRepository(Resource)
    private readonly resourceRepository: Repository<Resource>,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: Cache
  ) {}

  async findAll(): Promise<Resource[]> {
    return this.resourceRepository.find({ order: { name: 'ASC' } });
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
      throw new Error('Resource not found');
    }
    Object.assign(resource, data);
    const saved = await this.resourceRepository.save(resource);
    await this.invalidateSubjectMapCache();
    return saved;
  }

  async getSubjectMap(): Promise<Record<string, string>> {
    const cached = await this.cacheManager.get<Record<string, string>>(
      SUBJECT_MAP_CACHE_KEY
    );
    if (cached) {
      return cached;
    }

    const resources = await this.resourceRepository.find();
    const map: Record<string, string> = {};
    for (const r of resources) {
      map[r.name] = r.subject;
    }

    await this.cacheManager.set(
      SUBJECT_MAP_CACHE_KEY,
      map,
      SUBJECT_MAP_CACHE_TTL
    );
    return map;
  }

  async upsertResource(data: {
    name: string;
    subject: string;
    displayName: string;
    isSystem?: boolean;
  }): Promise<Resource> {
    const existing = await this.resourceRepository.findOne({
      where: { name: data.name }
    });

    if (existing) {
      existing.subject = data.subject;
      existing.displayName = data.displayName;
      existing.lastSyncedAt = new Date();
      return this.resourceRepository.save(existing);
    }

    const resource = this.resourceRepository.create({
      ...data,
      isSystem: data.isSystem ?? false,
      lastSyncedAt: new Date()
    });
    return this.resourceRepository.save(resource);
  }

  async invalidateSubjectMapCache(): Promise<void> {
    await this.cacheManager.del(SUBJECT_MAP_CACHE_KEY);
  }
}
