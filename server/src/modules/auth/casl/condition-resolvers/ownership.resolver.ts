import { Injectable } from '@nestjs/common';
import type { PermissionCondition } from '@app/shared/types';
import {
  ConditionResolver,
  ResolverContext,
  ResolverOutcome
} from './condition-resolver.interface';

@Injectable()
export class OwnershipResolver implements ConditionResolver<'ownership'> {
  readonly key = 'ownership' as const;

  resolve(
    value: NonNullable<PermissionCondition['ownership']>,
    ctx: ResolverContext
  ): ResolverOutcome {
    return { fragment: { [value.userField]: ctx.userId } };
  }
}
