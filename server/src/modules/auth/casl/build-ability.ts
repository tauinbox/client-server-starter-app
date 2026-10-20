import type { ResolvedPermission, SubjectMaps } from '@app/shared/types';
import {
  compileAbilityRules,
  type AbilityLogger
} from '@app/shared/utils/ability-rules';
import {
  Actions,
  AppAbility,
  createMongoAbility,
  Subjects
} from './app-ability';

/**
 * Builds a user's ability from already-loaded permissions and resource maps.
 *
 * Pure on purpose: `CaslAbilityFactory` calls it with the cached maps, and the
 * read-only `check:grant-scope` report calls it with maps built from its own
 * SELECT, so the report judges grants against the exact ability the
 * application builds.
 */
export function buildAbility(
  userId: string,
  isSuper: boolean,
  permissions: ResolvedPermission[],
  subjectMaps: SubjectMaps,
  logger: AbilityLogger
): AppAbility {
  return createMongoAbility<AppAbility>(
    compileAbilityRules<Actions, Extract<Subjects, string>>(
      userId,
      isSuper,
      permissions,
      subjectMaps,
      logger
    )
  );
}
