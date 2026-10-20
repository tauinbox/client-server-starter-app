import { HttpException, type Logger } from '@nestjs/common';
import {
  findGrantRefusal,
  findLiftRefusal,
  type GrantRefusal,
  type GrantScopeAbility,
  type GrantScopeItem
} from '@app/shared/utils/grant-scope';
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

function grantDenied(refusal: GrantRefusal): HttpException {
  const { status, message, errorKey, details } = refusal;
  return new HttpException({ message, errorKey, details }, status);
}

/**
 * Throws the 403 of `findGrantRefusal`: the caller can grant only what it
 * holds, and a conditional holder only a condition at least as narrow.
 */
export function assertCanGrantPermissions(
  ability: AppAbility,
  items: GrantScopeItem[],
  ctx: GrantCheckContext
): void {
  const refusal = findGrantRefusal(scopeOf(ability), items, ctx);
  if (refusal) throw grantDenied(refusal);
}

/**
 * Throws the 403 of `findLiftRefusal`: only a caller holding the pair without
 * restriction can remove a deny row.
 */
export function assertCanLiftDenies(
  ability: AppAbility,
  items: GrantScopeItem[]
): void {
  const refusal = findLiftRefusal(scopeOf(ability), items);
  if (refusal) throw grantDenied(refusal);
}
