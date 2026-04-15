import { Brackets, SelectQueryBuilder } from 'typeorm';
import type { AppAbility } from '../../auth/casl/app-ability';
import type { User } from '../entities/user.entity';

const USER_FIELD_MAP: Record<string, string> = {
  id: 'user.id',
  email: 'user.email',
  firstName: 'user.firstName',
  lastName: 'user.lastName',
  isActive: 'user.isActive'
};

/**
 * Restrict a User QueryBuilder to the rows the caller's CASL ability can
 * access for the given action. Rules without conditions grant full access;
 * otherwise rule conditions are translated to TypeORM WHERE fragments and
 * ORed together. A caller with no matching allow rule sees no rows.
 *
 * Handles MongoQuery fragments produced by CaslAbilityFactory:
 *   - ownership     → `{ field: userId }`
 *   - fieldMatch    → `{ field: { $in: [...] } }`
 *   - userAttr      → `{ field: userId }` (id is the only current attr)
 */
export function applyAbilityToUserQuery(
  qb: SelectQueryBuilder<User>,
  ability: AppAbility,
  action: string
): SelectQueryBuilder<User> {
  if (ability.can('manage', 'all') || ability.can(action, 'all')) {
    return qb;
  }

  const rules = ability.rulesFor(action, 'User').filter((r) => !r.inverted);

  if (rules.length === 0) {
    qb.andWhere('1 = 0');
    return qb;
  }

  if (rules.some((r) => !r.conditions)) {
    return qb;
  }

  qb.andWhere(
    new Brackets((bqb) => {
      let paramIdx = 0;
      let first = true;
      for (const rule of rules) {
        const conds = rule.conditions as Record<string, unknown>;
        const fragments: string[] = [];
        const params: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(conds)) {
          const column = USER_FIELD_MAP[field];
          if (!column) continue;
          if (
            value !== null &&
            typeof value === 'object' &&
            '$in' in (value as Record<string, unknown>) &&
            Array.isArray((value as { $in: unknown[] }).$in)
          ) {
            const p = `abFilter_${paramIdx++}`;
            fragments.push(`${column} IN (:...${p})`);
            params[p] = (value as { $in: unknown[] }).$in;
          } else {
            const p = `abFilter_${paramIdx++}`;
            fragments.push(`${column} = :${p}`);
            params[p] = value;
          }
        }
        if (fragments.length === 0) continue;
        const clause = fragments.join(' AND ');
        if (first) {
          bqb.where(clause, params);
          first = false;
        } else {
          bqb.orWhere(clause, params);
        }
      }
      if (first) {
        // No translatable fragment in any rule — deny by default
        bqb.where('1 = 0');
      }
    })
  );

  return qb;
}
