import { Injectable } from '@nestjs/common';
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
        if (!subject) continue;

        const action = p.action as Actions;

        if (p.conditions?.ownership) {
          // CASL infers MongoQuery<never> for string subjects — cast is required
          can(action, subject, { id: userId } as MongoQuery<never>);
        } else {
          can(action, subject);
        }
      }
    }

    return build();
  }
}
