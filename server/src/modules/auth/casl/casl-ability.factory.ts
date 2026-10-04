import { Injectable, Logger } from '@nestjs/common';
import { ResolvedPermission } from '@app/shared/types';
import { AppAbility } from './app-ability';
import { ResourceService } from '../services/resource.service';
import { PermissionService, RoleInfo } from '../services/permission.service';
import { buildAbility } from './build-ability';

export interface ResolvedAbility {
  ability: AppAbility;
  roles: RoleInfo[];
  permissions: ResolvedPermission[];
}

@Injectable()
export class CaslAbilityFactory {
  private readonly logger = new Logger(CaslAbilityFactory.name);

  constructor(
    private readonly resourceService: ResourceService,
    private readonly permissionService: PermissionService
  ) {}

  async resolveForUser(userId: string): Promise<ResolvedAbility> {
    const [roles, permissions] = await Promise.all([
      this.permissionService.getRolesForUser(userId),
      this.permissionService.getPermissionsForUser(userId)
    ]);
    const ability = await this.createForUser(userId, roles, permissions);
    return { ability, roles, permissions };
  }

  async createForUser(
    userId: string,
    roles: RoleInfo[],
    permissions: ResolvedPermission[]
  ): Promise<AppAbility> {
    const isSuper = roles.some((r) => r.isSuper);
    // A super role resolves no resource, so it skips the lookup.
    const subjectMaps = isSuper
      ? {
          active: {},
          orphaned: {},
          grantableActions: {},
          conditionalActions: {}
        }
      : await this.resourceService.getSubjectMaps();
    return buildAbility(userId, isSuper, permissions, subjectMaps, this.logger);
  }
}
