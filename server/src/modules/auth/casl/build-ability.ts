import type { Logger } from '@nestjs/common';
import type { ResolvedPermission } from '@app/shared/types';
import {
  AbilityBuilder,
  AppAbility,
  createMongoAbility,
  Subjects
} from './app-ability';
import { resolveConditions } from './resolve-conditions';
import {
  CASL_RESERVED_ACTION_NAMES,
  CASL_RESERVED_SUBJECT_NAMES
} from './constants';
import type { SubjectMaps } from '../services/resource.service';

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
  logger: Logger
): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(
    createMongoAbility
  );

  if (isSuper) {
    can('manage', 'all');
    return build();
  }

  // CASL evaluates rules in order; inverted rules (cannot) must come after
  // direct rules (can) to override them. Partition so allows are registered
  // first, denies last.
  const ordered = [
    ...permissions.filter((p) => p.conditions?.effect !== 'deny'),
    ...permissions.filter((p) => p.conditions?.effect === 'deny')
  ];

  for (const p of ordered) {
    const action = p.action;
    const isDeny = p.conditions?.effect === 'deny';
    const register = isDeny ? cannot : can;

    // Fail closed in both directions, as the condition veto below does: an
    // allow needs a live resource, while a deny must outlive its resource
    // going orphaned rather than vanish with it.
    const rawSubject = isDeny
      ? (subjectMaps.active[p.resource] ?? subjectMaps.orphaned[p.resource])
      : subjectMaps.active[p.resource];

    if (!rawSubject) {
      if (isDeny) {
        logger.error(
          `Deny permission "${p.permission}" for user ${userId} names unknown resource "${p.resource}" - the deny cannot be registered`
        );
      } else {
        logger.warn(
          `Unknown resource "${p.resource}" in permissions for user ${userId} — skipping`
        );
      }
      continue;
    }

    // Cast to Extract<Subjects, string> because AbilityBuilder.can()/cannot()
    // take constructors or string literals — never entity instances (those
    // are for ability.can() checks).
    const subject = rawSubject as Extract<Subjects, string>;

    // A reserved keyword reaching here bypassed the write-time checks, and
    // can('manage', X) / can(X, 'all') grant far beyond what the permission
    // names. The deny stays registered - inverting a wildcard is strictly
    // more restrictive, and dropping an authored deny would fail open.
    if (
      CASL_RESERVED_ACTION_NAMES.includes(action) ||
      CASL_RESERVED_SUBJECT_NAMES.includes(subject.toLowerCase())
    ) {
      logger.error(
        `Permission "${p.permission}" for user ${userId} uses a reserved CASL keyword (action "${action}", subject "${subject}") - ${
          isDeny ? 'registered as a blanket deny' : 'not registered'
        }`
      );
      if (isDeny) {
        register(action, subject);
      }
      continue;
    }

    if (!p.conditions) {
      register(action, subject);
      continue;
    }

    const queryResult = resolveConditions(p.conditions, {
      userId,
      permissionLabel: p.permission,
      logger
    });

    if (queryResult.skipPermission) {
      // Fail closed in both directions: a vetoed allow grants nothing,
      // while a vetoed deny must still deny everything rather than vanish.
      if (isDeny) {
        register(action, subject);
      }
      continue;
    }

    if (Object.keys(queryResult.query).length > 0) {
      register(action, subject, queryResult.query);
    } else {
      // Empty query here means the condition object carried no restriction
      // branches at all (e.g. only `effect`) - an unconditional rule.
      register(action, subject);
    }
  }

  return build();
}
