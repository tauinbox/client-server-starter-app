import type { Logger } from '@nestjs/common';
import type { PermissionCondition } from '@app/shared/types';

/**
 * Runtime context passed to every resolver. Carries the user identity used by
 * ownership/userAttr resolvers and the permission label so resolvers can emit
 * useful warnings when they reject malformed input.
 */
export interface ResolverContext {
  userId: string;
  permissionLabel: string;
  logger: Logger;
}

/**
 * Outcome of resolving a single condition fragment.
 *
 * - `fragment` — MongoQuery fields to merge into the rule's conditions object.
 *   Multiple resolvers contribute; later writes overwrite earlier ones (matches
 *   pre-refactor behaviour, where each `if` block ran in source order against
 *   a shared `query` object).
 * - `skipPermission` — security veto. Drops the entire permission for this user
 *   (no `can()` call is made). Use when the input is unsafe enough that even
 *   an unconditional grant would be wrong (e.g. denied MongoQuery operator).
 */
export interface ResolverOutcome {
  fragment?: Record<string, unknown>;
  skipPermission?: true;
}

export type PermissionConditionKey = keyof PermissionCondition;

/**
 * Strategy for translating one branch of `PermissionCondition` (e.g. ownership,
 * fieldMatch) into MongoQuery fragments. Register implementations under the
 * `CONDITION_RESOLVERS` token; `CaslAbilityFactory` discovers and applies them.
 */
export interface ConditionResolver<
  K extends PermissionConditionKey = PermissionConditionKey
> {
  readonly key: K;
  resolve(
    value: NonNullable<PermissionCondition[K]>,
    ctx: ResolverContext
  ): ResolverOutcome;
}
