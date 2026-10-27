import type { Logger } from '@nestjs/common';
import {
  findGrantRefusal,
  findLiftRefusal,
  type GrantRefusal,
  type GrantScopeAbility,
  type GrantScopeItem
} from '@app/shared/utils/grant-scope';
import { ApiError } from '../../../common/errors/api-error';
import type { AppAbility, Subjects } from '../casl/app-ability';

export interface GrantCheckContext {
  actorId?: string;
  logger: Logger;
}

// A grant names its subject by the string stored on the resource row.
function scopeOf(ability: AppAbility): GrantScopeAbility {
  return {
    can: (action, subject) =>
      ability.can(action, subject as Extract<Subjects, string>),
    rulesFor: (action, subject) =>
      ability.rulesFor(action, subject as Extract<Subjects, string>)
  };
}

export function grantDenied(refusal: GrantRefusal): ApiError {
  const { message, errorKey, details } = refusal;
  return new ApiError(errorKey, message, { details });
}

/**
 * The refusal of `findGrantRefusal`: the caller can grant only what it
 * holds, and a conditional holder only a condition at least as narrow.
 */
export function grantRefusalOf(
  ability: AppAbility,
  items: GrantScopeItem[],
  ctx: GrantCheckContext
): GrantRefusal | null {
  return findGrantRefusal(scopeOf(ability), items, ctx);
}

/**
 * The refusal of `findLiftRefusal`: only a caller holding the pair without
 * restriction can remove a deny row.
 */
export function liftRefusalOf(
  ability: AppAbility,
  items: GrantScopeItem[]
): GrantRefusal | null {
  return findLiftRefusal(scopeOf(ability), items);
}
