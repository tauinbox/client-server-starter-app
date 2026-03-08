import { Injectable, Logger } from '@nestjs/common';
import type { MongoQuery } from '@casl/ability';
import { ResolvedPermission } from '@app/shared/types';
import {
  AbilityBuilder,
  Actions,
  AppAbility,
  createMongoAbility,
  SUBJECT_MAP
} from './app-ability';

@Injectable()
export class CaslAbilityFactory {
  private readonly logger = new Logger(CaslAbilityFactory.name);

  createForUser(
    userId: string,
    roles: string[],
    permissions: ResolvedPermission[]
  ): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    if (roles.includes('admin')) {
      can('manage', 'all');
    } else {
      for (const p of permissions) {
        const subject = SUBJECT_MAP[p.resource];
        if (!subject) {
          this.logger.warn(
            `Unknown resource "${p.resource}" in permissions for user ${userId} — skipping`
          );
          continue;
        }

        const action = p.action as Actions;

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
            // Merge via entries to avoid prototype pollution from __proto__ /
            // constructor keys that Object.assign would forward to the setter
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
          // CASL infers MongoQuery<never> for string subjects — cast is required
          can(action, subject, query as MongoQuery<never>);
        } else {
          can(action, subject);
        }
      }
    }

    return build();
  }
}
