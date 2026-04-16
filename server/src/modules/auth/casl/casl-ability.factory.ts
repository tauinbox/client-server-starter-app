import { Injectable, Logger } from '@nestjs/common';
import { ResolvedPermission } from '@app/shared/types';
import { findDeniedMongoKey } from '@app/shared/utils/mongo-query-safety';
import {
  AbilityBuilder,
  AppAbility,
  createMongoAbility,
  Subjects
} from './app-ability';
import { ResourceService } from '../services/resource.service';

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
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    if (roles.some((r) => r.isSuper)) {
      can('manage', 'all');
    } else {
      const subjectMap = await this.resourceService.getSubjectMap();

      for (const p of permissions) {
        const rawSubject = subjectMap[p.resource];
        if (!rawSubject) {
          this.logger.warn(
            `Unknown resource "${p.resource}" in permissions for user ${userId} — skipping`
          );
          continue;
        }

        // Values in subjectMap come from @RegisterResource and are valid string subjects.
        // Cast to Extract<Subjects, string> because AbilityBuilder.can() takes constructors
        // or string literals — never entity instances (those are for ability.can() checks).
        const subject = rawSubject as Extract<Subjects, string>;
        const action = p.action;

        if (!p.conditions) {
          can(action, subject);
          continue;
        }

        const query: Record<string, unknown> = {};

        // ownership: record[field] === userId
        if (p.conditions.ownership) {
          query[p.conditions.ownership.userField] = userId;
        }

        // fieldMatch: record[field] must be one of the allowed values
        if (p.conditions.fieldMatch) {
          for (const [field, values] of Object.entries(
            p.conditions.fieldMatch
          )) {
            if (Array.isArray(values) && values.length > 0) {
              query[field] = { $in: values };
            }
          }
        }

        // userAttr: record[field] === user[attrName]
        // userContext can be extended as more user attributes become available
        if (p.conditions.userAttr) {
          const userContext: Record<string, unknown> = { id: userId };
          for (const [field, attrName] of Object.entries(
            p.conditions.userAttr
          )) {
            if (typeof attrName === 'string' && attrName in userContext) {
              query[field] = userContext[attrName];
            } else {
              this.logger.warn(
                `userAttr references unknown attribute "${String(attrName)}" for user ${userId} — skipping field "${field}"`
              );
            }
          }
        }

        // custom: raw JSON MongoQuery merged into the conditions object
        if (p.conditions.custom) {
          try {
            const parsed = JSON.parse(p.conditions.custom) as Record<
              string,
              unknown
            >;
            const denied = findDeniedMongoKey(parsed);
            if (denied) {
              this.logger.warn(
                `Denied operator "${denied}" in custom condition for user ${userId}, permission "${p.permission}" — skipping entire permission`
              );
              continue;
            }
            for (const [k, v] of Object.entries(parsed)) {
              query[k] = v;
            }
          } catch {
            this.logger.warn(
              `Invalid JSON in custom condition for user ${userId}: "${p.conditions.custom}" — skipping`
            );
          }
        }

        if (Object.keys(query).length > 0) {
          can(action, subject, query);
        } else {
          can(action, subject);
        }
      }
    }

    return build();
  }
}
