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
import { ResourceRegistryService } from './resource-registry.service';

@Injectable()
export class ResourceSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ResourceSyncService.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly resourceService: ResourceService,
    private readonly resourceRegistry: ResourceRegistryService,
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
    const actions = await this.actionRepository.find();

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
          !name.includes('OAuth') &&
          !name.includes('Prometheus')
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

      // Check orphaned status before upserting so we can warn if needed
      const existing = await this.resourceRepository.findOne({
        where: { name: meta.name }
      });
      if (existing?.isOrphaned) {
        this.logger.warn(
          `Resource "${meta.name}" was previously orphaned and its controller is back. Permissions remain disabled until an admin explicitly restores it via POST /api/v1/rbac/resources/${existing.id}/restore`
        );
      }

      const resource = await this.resourceService.upsertResource({
        name: meta.name,
        subject: meta.subject,
        displayName: meta.displayName,
        isSystem: true
      });

      // Auto-create permissions for this resource × all actions
      if (actions.length > 0) {
        const existingPermissions = await this.permissionRepository.find({
          where: { resourceId: resource.id }
        });
        const existingActionIds = new Set(
          existingPermissions.map((permission) => permission.actionId)
        );
        const missingActions = actions.filter(
          (action) => !existingActionIds.has(action.id)
        );
        if (missingActions.length > 0) {
          await this.permissionRepository.save(
            missingActions.map((action) =>
              this.permissionRepository.create({
                resourceId: resource.id,
                actionId: action.id
              })
            )
          );
          for (const action of missingActions) {
            this.logger.log(`Created permission: ${meta.name}:${action.name}`);
          }
        }
      }

      this.logger.log(`Synced resource: ${meta.name} → ${meta.subject}`);
    }

    // Mark unregistered resources as orphaned
    const allResources = await this.resourceRepository.find();
    for (const resource of allResources) {
      if (registeredNames.has(resource.name)) continue;
      if (!resource.isOrphaned) {
        resource.isOrphaned = true;
        await this.resourceRepository.save(resource);
      }
      this.logger.warn(
        `Resource "${resource.name}" is orphaned — no controller registered it. Permissions for this resource are disabled.`
      );
    }

    this.resourceRegistry.register([...registeredNames]);
    await this.resourceService.invalidateSubjectMapCache();
  }
}
