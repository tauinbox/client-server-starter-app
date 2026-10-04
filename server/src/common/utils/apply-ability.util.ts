import { Logger } from '@nestjs/common';
import { Brackets, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import {
  ABILITY_FILTER_FIELDS,
  type AbilityFilterSubject
} from '@app/shared/constants';
import {
  translateRuleSet,
  type ColumnResolver,
  type RuleSetTranslation
} from '@app/shared/utils/ability-sql-translation';
import type { AppAbility } from '../../modules/auth/casl/app-ability';
import type { User } from '../../modules/users/entities/user.entity';
import type { FeatureFlag } from '../../modules/feature-flags/entities/feature-flag.entity';

const logger = new Logger('applyAbilityToQuery');

function columnResolver(
  subject: AbilityFilterSubject,
  alias: string
): ColumnResolver {
  const fields: readonly string[] = ABILITY_FILTER_FIELDS[subject];
  return (field) => (fields.includes(field) ? `${alias}.${field}` : undefined);
}

function logSkipped(translation: RuleSetTranslation<unknown>): void {
  for (const { reason, conditions } of translation.skipped) {
    logger.warn(
      `Skipping CASL rule with untranslatable conditions (${reason}): ${JSON.stringify(conditions)}`
    );
  }
}

/**
 * Restrict a QueryBuilder to the rows the caller's CASL ability can access
 * for the given action on the subject. Allow rules without conditions grant
 * full access; otherwise rule conditions are translated to TypeORM WHERE
 * fragments, ORed within each polarity and combined as `allow AND NOT deny`. A
 * caller with no matching allow rule sees no rows.
 *
 * `CaslAbilityFactory` registers every allow before every deny, and CASL
 * resolves a check with the last-declared matching rule (`relevantRuleFor`
 * walks `rulesFor` output, which is ordered newest-declared first). So a
 * matching deny always outranks every allow, which makes `allow AND NOT deny`
 * an exact translation of the in-memory semantics, not an approximation.
 *
 * Translates MongoQuery fragments produced by CaslAbilityFactory:
 *   - field equality:        `{ field: scalar }`
 *   - comparison operators:  `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
 *   - list operators:        `$in`, `$nin`
 *   - logical operators:     `$and`, `$or`, `$nor`, `$not`
 *
 * Fail-closed: if a rule contains any unknown operator, a field outside
 * `ABILITY_FILTER_FIELDS`, or an unsupported value shape, the ENTIRE rule is
 * dropped (and a warn logged). Partial translation would produce SQL strictly
 * less restrictive than the source rule and silently over-share. For a deny,
 * dropping the rule is itself a widening, so an untranslatable deny degrades
 * the whole query to no rows.
 */
export function applyAbilityToQuery<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  ability: AppAbility,
  action: string,
  subject: AbilityFilterSubject,
  alias: string
): SelectQueryBuilder<T> {
  if (ability.can('manage', 'all') || ability.can(action, 'all')) {
    return qb;
  }

  const rules = ability.rulesFor(action, subject);
  const allowRules = rules.filter((r) => !r.inverted);
  const denyRules = rules.filter((r) => r.inverted);

  if (allowRules.length === 0) {
    qb.andWhere('1 = 0');
    return qb;
  }

  const columnFor = columnResolver(subject, alias);
  const paramIdx = { value: 0 };
  const allow = translateRuleSet(allowRules, paramIdx, columnFor);
  logSkipped(allow);
  const deny =
    denyRules.length > 0
      ? translateRuleSet(denyRules, paramIdx, columnFor)
      : null;
  if (deny) logSkipped(deny);

  if (deny && (deny.kind === 'always' || deny.skipped.length > 0)) {
    logger.warn(
      deny.kind === 'always'
        ? 'Unconditional deny rule matches every row — restricting query to no rows'
        : 'Untranslatable deny rule cannot be enforced in SQL — restricting query to no rows'
    );
    qb.andWhere('1 = 0');
    return qb;
  }

  if (allow.kind === 'always' && !deny) {
    return qb;
  }

  qb.andWhere(
    new Brackets((bqb) => {
      if (allow.kind === 'never') {
        bqb.where('1 = 0');
        return;
      }
      if (allow.kind === 'conditional') {
        bqb.where(allow.sql, allow.params);
      }
      if (deny?.kind === 'conditional') {
        const negated = `NOT (${deny.sql})`;
        if (allow.kind === 'always') {
          bqb.where(negated, deny.params);
        } else {
          bqb.andWhere(negated, deny.params);
        }
      }
    })
  );

  return qb;
}

/** `applyAbilityToQuery` for a User query aliased `user`. */
export function applyAbilityToUserQuery(
  qb: SelectQueryBuilder<User>,
  ability: AppAbility,
  action: string
): SelectQueryBuilder<User> {
  return applyAbilityToQuery(qb, ability, action, 'User', 'user');
}

/** `applyAbilityToQuery` for a FeatureFlag query aliased `flag`. */
export function applyAbilityToFeatureFlagQuery(
  qb: SelectQueryBuilder<FeatureFlag>,
  ability: AppAbility,
  action: string
): SelectQueryBuilder<FeatureFlag> {
  return applyAbilityToQuery(qb, ability, action, 'FeatureFlag', 'flag');
}
