import { Injectable, Logger } from '@nestjs/common';
import { ResolvedPermission } from '@app/shared/types';
import {
  AbilityBuilder,
  AppAbility,
  createMongoAbility,
  Subjects
} from './app-ability';
import { ResourceService } from '../services/resource.service';
import { resolveConditions } from './resolve-conditions';

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
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(
      createMongoAbility
    );

    if (roles.some((r) => r.isSuper)) {
      can('manage', 'all');
      return build();
    }

    const subjectMaps = await this.resourceService.getSubjectMaps();

    // CASL evaluates rules in order; inverted rules (cannot) must come after
    // direct rules (can) to override them. Partition so allows are registered
    // first, denies last.
    const ordered = [
      ...permissions.filter((p) => p.conditions?.effect !== 'deny'),
      ...permissions.filter((p) => p.conditions?.effect === 'deny')
    ];

    for (const p of ordered) {
      const action = p.action;
      const isDeny = p.conditions?.effect === 'deny';
      const register = isDeny ? cannot : can;

      // Fail closed in both directions, as the condition veto below does: an
      // allow needs a live resource, while a deny must outlive its resource
      // going orphaned rather than vanish with it.
      const rawSubject = isDeny
        ? (subjectMaps.active[p.resource] ?? subjectMaps.orphaned[p.resource])
        : subjectMaps.active[p.resource];

      if (!rawSubject) {
        if (isDeny) {
          this.logger.error(
            `Deny permission "${p.permission}" for user ${userId} names unknown resource "${p.resource}" - the deny cannot be registered`
          );
        } else {
          this.logger.warn(
            `Unknown resource "${p.resource}" in permissions for user ${userId} — skipping`
          );
        }
        continue;
      }

      // Cast to Extract<Subjects, string> because AbilityBuilder.can()/cannot()
      // take constructors or string literals — never entity instances (those
      // are for ability.can() checks).
      const subject = rawSubject as Extract<Subjects, string>;

      if (!p.conditions) {
        register(action, subject);
        continue;
      }

      const queryResult = resolveConditions(p.conditions, {
        userId,
        permissionLabel: p.permission,
        logger: this.logger
      });

      if (queryResult.skipPermission) {
        // Fail closed in both directions: a vetoed allow grants nothing,
        // while a vetoed deny must still deny everything rather than vanish.
        if (isDeny) {
          register(action, subject);
        }
        continue;
      }

      if (Object.keys(queryResult.query).length > 0) {
        register(action, subject, queryResult.query);
      } else {
        // Empty query here means the condition object carried no restriction
        // branches at all (e.g. only `effect`) - an unconditional rule.
        register(action, subject);
      }
    }

    return build();
  }
}
