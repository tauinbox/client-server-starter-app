import { Injectable } from '@nestjs/common';
import type { PermissionCondition } from '@app/shared/types';
import {
  ConditionResolver,
  ResolverContext,
  ResolverOutcome
} from './condition-resolver.interface';

@Injectable()
export class FieldMatchResolver implements ConditionResolver<'fieldMatch'> {
  readonly key = 'fieldMatch' as const;

  resolve(
    value: NonNullable<PermissionCondition['fieldMatch']>,
    _ctx: ResolverContext
  ): ResolverOutcome {
    const fragment: Record<string, unknown> = {};
    for (const [field, values] of Object.entries(value)) {
      if (Array.isArray(values) && values.length > 0) {
        fragment[field] = { $in: values };
      }
    }
    return { fragment };
  }
}
