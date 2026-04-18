import { Injectable } from '@nestjs/common';
import type { PermissionCondition } from '@app/shared/types';
import { findDeniedMongoKey } from '@app/shared/utils/mongo-query-safety';
import {
  ConditionResolver,
  ResolverContext,
  ResolverOutcome
} from './condition-resolver.interface';

@Injectable()
export class CustomResolver implements ConditionResolver<'custom'> {
  readonly key = 'custom' as const;

  resolve(
    value: NonNullable<PermissionCondition['custom']>,
    ctx: ResolverContext
  ): ResolverOutcome {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(value) as Record<string, unknown>;
    } catch {
      ctx.logger.warn(
        `Invalid JSON in custom condition for user ${ctx.userId}: "${value}" — skipping`
      );
      return {};
    }

    const denied = findDeniedMongoKey(parsed);
    if (denied) {
      ctx.logger.warn(
        `Denied operator "${denied}" in custom condition for user ${ctx.userId}, permission "${ctx.permissionLabel}" — skipping entire permission`
      );
      return { skipPermission: true };
    }

    return { fragment: parsed };
  }
}
