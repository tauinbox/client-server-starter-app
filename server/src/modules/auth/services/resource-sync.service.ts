import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RESOURCE_METADATA_KEY,
  ResourceMetadata
} from '../decorators/register-resource.decorator';
import { Resource } from '../entities/resource.entity';
import { Permission } from '../entities/permission.entity';
import { Action } from '../entities/action.entity';
import { ResourceService } from './resource.service';

@Injectable()
export class ResourceSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ResourceSyncService.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly resourceService: ResourceService,
    @InjectRepository(Resource)
    private readonly resourceRepository: Repository<Resource>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(Action)
    private readonly actionRepository: Repository<Action>
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.syncResources();
    } catch (error) {
      this.logger.warn(
        'Resource sync skipped — tables may not exist yet. Run migrations first.',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async syncResources(): Promise<void> {
    const registeredNames = new Set<string>();
    const controllers = this.discoveryService.getControllers();

    for (const wrapper of controllers) {
      const metatype = wrapper.metatype as
        | (new (...args: unknown[]) => unknown)
        | undefined;
      if (!metatype) continue;

      const meta = this.reflector.get<ResourceMetadata | undefined>(
        RESOURCE_METADATA_KEY,
        metatype
      );

      if (!meta) {
        const name = metatype.name;
        if (
          !name.includes('Health') &&
          !name.includes('Auth') &&
          !name.includes('OAuth')
        ) {
          this.logger.debug(
            `Controller ${name} has no @RegisterResource decorator`
          );
        }
        continue;
      }

      if (registeredNames.has(meta.name)) continue;
      registeredNames.add(meta.name);

      // Warn early if subject is not PascalCase — upsertResource auto-normalizes,
      // but this surfaces decorator misconfiguration to developers at startup
      if (meta.subject.charAt(0) !== meta.subject.charAt(0).toUpperCase()) {
        this.logger.warn(
          `@RegisterResource subject "${meta.subject}" on controller "${metatype.name}" is not PascalCase — auto-normalizing. Fix the decorator to suppress this warning.`
        );
      }

      const resource = await this.resourceService.upsertResource({
        name: meta.name,
        subject: meta.subject,
        displayName: meta.displayName,
        isSystem: true
      });

      // Auto-create permissions for this resource × all actions
      const actions = await this.actionRepository.find();
      for (const action of actions) {
        const exists = await this.permissionRepository.findOne({
          where: { resourceId: resource.id, actionId: action.id }
        });
        if (!exists) {
          await this.permissionRepository.save(
            this.permissionRepository.create({
              resourceId: resource.id,
              actionId: action.id
            })
          );
          this.logger.log(`Created permission: ${meta.name}:${action.name}`);
        }
      }

      this.logger.log(`Synced resource: ${meta.name} → ${meta.subject}`);
    }

    // Log orphaned resources
    const allResources = await this.resourceRepository.find();
    for (const resource of allResources) {
      if (!registeredNames.has(resource.name)) {
        this.logger.warn(
          `Orphaned resource detected: "${resource.name}" — not registered by any controller`
        );
      }
    }

    await this.resourceService.invalidateSubjectMapCache();
  }
}
