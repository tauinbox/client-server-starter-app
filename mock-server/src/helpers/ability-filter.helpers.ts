import { subject as caslSubject } from '@casl/ability';
import {
  ABILITY_FILTER_FIELDS,
  type AbilityFilterSubject
} from '@app/shared/constants';
import { translateRuleSet } from '@app/shared/utils/ability-sql-translation';
import { buildAbilityForUser, type Actions } from '../state';
import type { MockUser } from '../types';

/**
 * Mirrors `applyAbilityToQuery` on the server: keeps the records that the
 * caller's ability allows for the action. The server keeps only the rules
 * that translate to SQL, so the same translation decides which rules count
 * here, and CASL evaluates the kept rules against each record.
 */
export function filterByAbility<T extends object>(
  records: T[],
  user: MockUser,
  action: Actions,
  subjectName: AbilityFilterSubject
): T[] {
  const ability = buildAbilityForUser(user);
  if (ability.can('manage', 'all') || ability.can(action, 'all')) {
    return records;
  }

  const rules = ability.rulesFor(action, subjectName);
  const allowRules = rules.filter((r) => !r.inverted);
  const denyRules = rules.filter((r) => r.inverted);
  if (allowRules.length === 0) return [];

  const fields: readonly string[] = ABILITY_FILTER_FIELDS[subjectName];
  const columnFor = (field: string) =>
    fields.includes(field) ? field : undefined;
  const paramIdx = { value: 0 };
  const allow = translateRuleSet(allowRules, paramIdx, columnFor);
  const deny =
    denyRules.length > 0
      ? translateRuleSet(denyRules, paramIdx, columnFor)
      : null;
  if (deny && (deny.kind === 'always' || deny.skipped.length > 0)) return [];

  return records.filter((record) => {
    const instance = caslSubject(subjectName, record);
    return (
      (allow.kind === 'always' ||
        allow.translated.some((rule) => rule.matchesConditions(instance))) &&
      !deny?.translated.some((rule) => rule.matchesConditions(instance))
    );
  });
}
