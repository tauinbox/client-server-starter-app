import { HttpException, Logger } from '@nestjs/common';
import type {
  PermissionCondition,
  ResolvedPermission
} from '@app/shared/types';
import {
  AbilityBuilder,
  createMongoAbility,
  type AppAbility,
  type Subjects
} from '../casl/app-ability';
import { resolveConditions } from '../casl/resolve-conditions';
import {
  CASL_RESERVED_ACTION_NAMES,
  CASL_RESERVED_SUBJECT_NAMES
} from '../casl/constants';
import { assertCanGrantPermissions } from './can-grant.util';

/**
 * Analysis behind `npm run check:grant-scope`: which stored grants the
 * grant-scope rule would reject if they were written today.
 *
 * `assertCanGrantPermissions` applies to writes only - rows already in
 * `role_permissions` are deliberately not re-validated, because retro-validating
 * live grants would silently strip permissions in production. This module is the
 * read-only diagnostic that fills that gap. It decides nothing and changes
 * nothing; the script that calls it only reads and prints.
 *
 * The verdicts come from the real `assertCanGrantPermissions` and the real
 * `resolveConditions`, so they cannot drift from the enforcement. Only the
 * ability construction is reproduced here (see `buildAbility`).
 */

/** One `role_permissions` row joined with the labels needed to judge it. */
export interface GrantRow {
  role_id: string;
  role_name: string;
  role_is_super: boolean;
  permission_id: string;
  action_name: string;
  resource_name: string;
  resource_subject: string;
  is_orphaned: boolean;
  conditions: PermissionCondition | null;
}

/** One `user_roles` row for an active, non-deleted user. */
export interface UserRoleRow {
  user_id: string;
  email: string;
  role_id: string;
  role_name: string;
  is_super: boolean;
}

/** One `PERMISSION_ASSIGN` audit row, oldest first. */
export interface AuditRow {
  role_id: string;
  actor_id: string | null;
  actor_email: string | null;
  created_at: Date;
  details: { permissionIds?: unknown } | null;
}

export interface Verdict {
  rejected: boolean;
  errorKey?: string;
  reason?: string;
  message?: string;
}

export interface Finding {
  row: GrantRow;
  author: AuditRow;
  verdict: Verdict;
  /**
   * The attributed author currently holds the role they granted to, so the
   * grant is reachable by the person who wrote it - the signature of a
   * self-assigned escalation, and the row to review first.
   */
  selfReachable: boolean;
}

export interface GrantScopeReport {
  totalGrants: number;
  activeUsersWithRoles: number;
  auditRows: number;
  /** Conditions the resolver vetoes: inert today, rejected on rewrite. */
  inert: GrantRow[];
  /** Attributed grants the check rejects today. */
  findings: Finding[];
  /** Attributed grants the check accepts today. */
  accepted: number;
  /** No audit row: seeded, or aged out of the retention window. */
  unattributed: number;
  /** Authored by a super role, which bypasses the check by design. */
  authorSuper: number;
  /** Authored by a user who is now inactive, deleted or role-less. */
  authorGone: number;
}

/** Keeps the resolver's fail-closed warnings out of the report body. */
export class SilentLogger extends Logger {
  warn(): void {}
  error(): void {}
  log(): void {}
}

const silent = new SilentLogger('grant-scope-report');

/**
 * Mirrors `CaslAbilityFactory.createForUser` for the rules this report needs:
 * allows before denies, reserved keywords skipped, an allow only from a live
 * resource, and a vetoed allow granting nothing.
 *
 * This is the one piece that is reproduced rather than reused - the factory
 * needs Nest DI and a repository, which a read-only report should not boot. Keep
 * it in step with that factory; the verdict itself comes from the real check.
 */
export function buildAbility(
  userId: string,
  isSuper: boolean,
  permissions: ResolvedPermission[],
  subjectMaps: { active: Set<string>; orphaned: Set<string> }
): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(
    createMongoAbility
  );

  if (isSuper) {
    can('manage', 'all');
    return build();
  }

  const ordered = [
    ...permissions.filter((p) => p.conditions?.effect !== 'deny'),
    ...permissions.filter((p) => p.conditions?.effect === 'deny')
  ];

  for (const p of ordered) {
    const isDeny = p.conditions?.effect === 'deny';
    const register = isDeny ? cannot : can;
    const subject = p.resource as Extract<Subjects, string>;

    const live = isDeny
      ? subjectMaps.active.has(p.resource) ||
        subjectMaps.orphaned.has(p.resource)
      : subjectMaps.active.has(p.resource);
    if (!live) continue;

    if (
      CASL_RESERVED_ACTION_NAMES.includes(p.action) ||
      CASL_RESERVED_SUBJECT_NAMES.includes(p.resource.toLowerCase())
    ) {
      if (isDeny) register(p.action, subject);
      continue;
    }

    if (!p.conditions) {
      register(p.action, subject);
      continue;
    }

    const resolved = resolveConditions(p.conditions, {
      userId,
      permissionLabel: p.permission,
      logger: silent
    });

    if (resolved.skipPermission) {
      if (isDeny) register(p.action, subject);
      continue;
    }

    if (Object.keys(resolved.query).length > 0) {
      register(p.action, subject, resolved.query);
    } else {
      register(p.action, subject);
    }
  }

  return build();
}

/** Runs the production grant check for one stored grant, as one actor. */
export function verdictFor(
  ability: AppAbility,
  actorId: string,
  row: GrantRow
): Verdict {
  try {
    assertCanGrantPermissions(
      ability,
      [
        {
          permissionId: row.permission_id,
          actionName: row.action_name,
          subject: row.resource_subject,
          bodyConditions: row.conditions
        }
      ],
      { actorId, logger: silent }
    );
    return { rejected: false };
  } catch (err) {
    if (!(err instanceof HttpException)) throw err;
    const body = err.getResponse();
    const parsed =
      typeof body === 'object' && body !== null
        ? (body as {
            errorKey?: string;
            message?: string;
            details?: { reason?: string };
          })
        : {};
    return {
      rejected: true,
      errorKey: parsed.errorKey,
      reason: parsed.details?.reason,
      message: parsed.message
    };
  }
}

/**
 * Builds the report from the three row sets the script selects.
 *
 * `findings` / `accepted` / `unattributed` / `authorSuper` / `authorGone`
 * partition every grant row. `inert` is a second, independent axis and overlaps
 * them: a vetoed grant is still attributed (or not) like any other.
 */
export function analyzeGrants(input: {
  grants: GrantRow[];
  userRoles: UserRoleRow[];
  auditRows: AuditRow[];
}): GrantScopeReport {
  const { grants, userRoles, auditRows } = input;

  const subjectMaps = {
    active: new Set(
      grants.filter((g) => !g.is_orphaned).map((g) => g.resource_name)
    ),
    orphaned: new Set(
      grants.filter((g) => g.is_orphaned).map((g) => g.resource_name)
    )
  };

  const rolesByUser = new Map<string, UserRoleRow[]>();
  for (const ur of userRoles) {
    const list = rolesByUser.get(ur.user_id) ?? [];
    list.push(ur);
    rolesByUser.set(ur.user_id, list);
  }

  const grantsByRole = new Map<string, GrantRow[]>();
  for (const g of grants) {
    const list = grantsByRole.get(g.role_id) ?? [];
    list.push(g);
    grantsByRole.set(g.role_id, list);
  }

  // Rows arrive oldest first, so a later write overwrites the attribution.
  const authorOf = new Map<string, AuditRow>();
  for (const row of auditRows) {
    const ids = Array.isArray(row.details?.permissionIds)
      ? (row.details.permissionIds as unknown[])
      : [];
    for (const pid of ids) {
      if (typeof pid === 'string') {
        authorOf.set(`${row.role_id}:${pid}`, row);
      }
    }
  }

  const inert: GrantRow[] = [];
  for (const g of grants) {
    if (!g.conditions) continue;
    const resolved = resolveConditions(g.conditions, {
      // The veto outcome does not depend on the id's value, only on the shape
      // of the condition, so any placeholder resolves it identically.
      userId: '00000000-0000-0000-0000-000000000000',
      permissionLabel: `${g.action_name}:${g.resource_subject}`,
      logger: silent
    });
    if (resolved.skipPermission) inert.push(g);
  }

  const abilityCache = new Map<string, AppAbility>();
  const abilityFor = (userId: string): AppAbility | null => {
    const cached = abilityCache.get(userId);
    if (cached) return cached;
    const roles = rolesByUser.get(userId);
    if (!roles) return null;
    const permissions: ResolvedPermission[] = roles.flatMap((r) =>
      (grantsByRole.get(r.role_id) ?? []).map((g) => ({
        resource: g.resource_name,
        action: g.action_name,
        permission: `${g.action_name}:${g.resource_subject}`,
        conditions: g.conditions
      }))
    );
    const ability = buildAbility(
      userId,
      roles.some((r) => r.is_super),
      permissions,
      subjectMaps
    );
    abilityCache.set(userId, ability);
    return ability;
  };

  const findings: Finding[] = [];
  let unattributed = 0;
  let authorGone = 0;
  let authorSuper = 0;
  let accepted = 0;

  for (const g of grants) {
    const author = authorOf.get(`${g.role_id}:${g.permission_id}`);
    if (!author?.actor_id) {
      unattributed++;
      continue;
    }
    const roles = rolesByUser.get(author.actor_id);
    if (!roles) {
      authorGone++;
      continue;
    }
    if (roles.some((r) => r.is_super)) {
      authorSuper++;
      continue;
    }
    const ability = abilityFor(author.actor_id);
    if (!ability) {
      authorGone++;
      continue;
    }
    const verdict = verdictFor(ability, author.actor_id, g);
    if (!verdict.rejected) {
      accepted++;
      continue;
    }
    findings.push({
      row: g,
      author,
      verdict,
      selfReachable: roles.some((r) => r.role_id === g.role_id)
    });
  }

  return {
    totalGrants: grants.length,
    activeUsersWithRoles: rolesByUser.size,
    auditRows: auditRows.length,
    inert,
    findings,
    accepted,
    unattributed,
    authorSuper,
    authorGone
  };
}

export function grantLabel(row: GrantRow): string {
  return `${row.role_name} -> ${row.action_name}:${row.resource_subject}`;
}
