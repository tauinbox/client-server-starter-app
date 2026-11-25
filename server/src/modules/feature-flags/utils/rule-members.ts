import { EntityManager, In } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { ApiError } from '../../../common/errors/api-error';
import type { FeatureFlagRule } from '../entities/feature-flag-rule.entity';
import { FeatureFlagRuleUser } from '../entities/feature-flag-rule-user.entity';

/**
 * Sets the members of each `user` rule from its member rows. The ids that the
 * payload still holds are kept too: a node of the previous build writes only
 * the payload during a rolling deploy.
 */
export async function attachRuleMembers(
  manager: EntityManager,
  rules: readonly Pick<FeatureFlagRule, 'id' | 'payload'>[]
): Promise<void> {
  const userRules = rules.filter((r) => r.payload.type === 'user');

  if (userRules.length === 0) return;

  const rows = await manager.find(FeatureFlagRuleUser, {
    where: { ruleId: In(userRules.map((r) => r.id)) },
    order: { userId: 'ASC' }
  });
  const byRule = new Map<string, string[]>();

  for (const { ruleId, userId } of rows) {
    const list = byRule.get(ruleId) ?? [];

    list.push(userId);
    byRule.set(ruleId, list);
  }

  for (const rule of userRules) {
    if (rule.payload.type !== 'user') continue;

    rule.payload = {
      type: 'user',
      userIds: [
        ...new Set([...rule.payload.userIds, ...(byRule.get(rule.id) ?? [])])
      ]
    };
  }
}

/**
 * Writes the member rows of a new `user` rule. An id with no user row (a soft
 * deleted user counts as a row) refuses the whole write, so a saved rule never
 * names a member that its table cannot hold.
 */
export async function writeRuleMembers(
  em: EntityManager,
  { ruleId, userIds }: { ruleId: string; userIds: readonly string[] }
): Promise<void> {
  const ids = [...new Set(userIds)];

  if (ids.length === 0) return;

  const inserted = await em.query<unknown[]>(
    `INSERT INTO "feature_flag_rule_users" ("rule_id", "user_id")
     SELECT $1, u."id" FROM "users" u WHERE u."id" = ANY($2::uuid[])
     RETURNING "user_id"`,
    [ruleId, ids]
  );

  if (inserted.length !== ids.length) {
    throw new ApiError(
      ErrorKeys.FEATURE_FLAGS.UNKNOWN_RULE_USER,
      'A user rule names a user that does not exist'
    );
  }
}
