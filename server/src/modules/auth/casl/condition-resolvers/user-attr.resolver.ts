import { Injectable } from '@nestjs/common';
import type { PermissionCondition } from '@app/shared/types';
import {
  ConditionResolver,
  ResolverContext,
  ResolverOutcome
} from './condition-resolver.interface';

@Injectable()
export class UserAttrResolver implements ConditionResolver<'userAttr'> {
  readonly key = 'userAttr' as const;

  resolve(
    value: NonNullable<PermissionCondition['userAttr']>,
    ctx: ResolverContext
  ): ResolverOutcome {
    // userContext can be extended as more user attributes become available.
    const userContext: Record<string, unknown> = { id: ctx.userId };
    const fragment: Record<string, unknown> = {};
    for (const [field, attrName] of Object.entries(value)) {
      if (typeof attrName === 'string' && attrName in userContext) {
        fragment[field] = userContext[attrName];
      } else {
        ctx.logger.warn(
          `userAttr references unknown attribute "${String(attrName)}" for user ${ctx.userId} — skipping field "${field}"`
        );
      }
    }
    return { fragment };
  }
}
