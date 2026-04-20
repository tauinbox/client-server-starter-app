import { Inject, Injectable, Logger } from '@nestjs/common';
import { PermissionCondition, ResolvedPermission } from '@app/shared/types';
import {
  AbilityBuilder,
  AppAbility,
  createMongoAbility,
  Subjects
} from './app-ability';
import { ResourceService } from '../services/resource.service';
import {
  CONDITION_RESOLVERS,
  ConditionResolver,
  ResolverContext
} from './condition-resolvers';

export interface RoleInfo {
  name: string;
  isSuper: boolean;
}

@Injectable()
export class CaslAbilityFactory {
  private readonly logger = new Logger(CaslAbilityFactory.name);

  constructor(
    private readonly resourceService: ResourceService,
    @Inject(CONDITION_RESOLVERS)
    private readonly resolvers: ConditionResolver[]
  ) {}

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

    const subjectMap = await this.resourceService.getSubjectMap();

    // CASL evaluates rules in order; inverted rules (cannot) must come after
    // direct rules (can) to override them. Partition so allows are registered
    // first, denies last.
    const ordered = [
      ...permissions.filter((p) => p.conditions?.effect !== 'deny'),
      ...permissions.filter((p) => p.conditions?.effect === 'deny')
    ];

    for (const p of ordered) {
      const rawSubject = subjectMap[p.resource];
      if (!rawSubject) {
        this.logger.warn(
          `Unknown resource "${p.resource}" in permissions for user ${userId} — skipping`
        );
        continue;
      }

      // Values in subjectMap come from @RegisterResource and are valid string subjects.
      // Cast to Extract<Subjects, string> because AbilityBuilder.can()/cannot() take
      // constructors or string literals — never entity instances (those are for
      // ability.can() checks).
      const subject = rawSubject as Extract<Subjects, string>;
      const action = p.action;
      const isDeny = p.conditions?.effect === 'deny';
      const register = isDeny ? cannot : can;

      if (!p.conditions) {
        register(action, subject);
        continue;
      }

      const queryResult = this.resolveConditions(p.conditions, {
        userId,
        permissionLabel: p.permission,
        logger: this.logger
      });

      if (queryResult.skipPermission) continue;

      if (Object.keys(queryResult.query).length > 0) {
        register(action, subject, queryResult.query);
      } else {
        register(action, subject);
      }
    }

    return build();
  }

  /**
   * Iterates registered resolvers, merging their MongoQuery fragments into a
   * single conditions object. A resolver may veto the entire permission
   * (e.g. unsafe custom operator) by returning `skipPermission`.
   */
  private resolveConditions(
    conditions: PermissionCondition,
    ctx: ResolverContext
  ): { query: Record<string, unknown>; skipPermission: boolean } {
    const query: Record<string, unknown> = {};
    for (const resolver of this.resolvers) {
      const value = conditions[resolver.key];
      if (value === undefined || value === null) continue;
      const outcome = resolver.resolve(value as never, ctx);
      if (outcome.skipPermission) {
        return { query, skipPermission: true };
      }
      if (outcome.fragment) {
        Object.assign(query, outcome.fragment);
      }
    }
    return { query, skipPermission: false };
  }
}
