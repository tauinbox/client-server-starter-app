import { Injectable, Logger } from '@nestjs/common';
import { ResolvedPermission } from '@app/shared/types';
import { AppAbility } from './app-ability';
import { ResourceService } from '../services/resource.service';
import { buildAbility } from './build-ability';

export interface RoleInfo {
  name: string;
  isSuper: boolean;
}

@Injectable()
export class CaslAbilityFactory {
  private readonly logger = new Logger(CaslAbilityFactory.name);

  constructor(private readonly resourceService: ResourceService) {}

  async createForUser(
    userId: string,
    roles: RoleInfo[],
    permissions: ResolvedPermission[]
  ): Promise<AppAbility> {
    const isSuper = roles.some((r) => r.isSuper);
    // A super role resolves no resource, so it skips the lookup.
    const subjectMaps = isSuper
      ? { active: {}, orphaned: {} }
      : await this.resourceService.getSubjectMaps();
    return buildAbility(userId, isSuper, permissions, subjectMaps, this.logger);
  }
}
