import {
  AbilityBuilder,
  createMongoAbility,
  MongoAbility
} from '@casl/ability';
import type { MongoQuery } from '@casl/ability';
import { packRules } from '@casl/ability/extra';
import type {
  MockAuditLog,
  MockUser,
  OAuthAccount,
  State,
  UserResponse
} from './types';
import type { PermissionCondition } from '@app/shared/types';
import {
  seedOAuthAccounts,
  seedUsers,
  seedRoles,
  seedPermissions,
  seedRolePermissions
} from './seed';

// Each Playwright worker imports this module in its own process,
// so state is isolated per worker. Do NOT share a single process
// across parallel test workers — state will collide.
let state: State;

export function resetState(): void {
  state = {
    users: new Map(seedUsers.map((u) => [u.id, { ...u }])),
    oauthAccounts: new Map(
      Array.from(seedOAuthAccounts.entries()).map(([k, v]) => [
        k,
        v.map((a) => ({ ...a }))
      ])
    ),
    refreshTokens: new Map(),
    emailVerificationTokens: new Map(),
    passwordResetTokens: new Map(),
    roles: new Map(seedRoles.map((r) => [r.id, { ...r }])),
    permissions: new Map(seedPermissions.map((p) => [p.id, { ...p }])),
    rolePermissions: seedRolePermissions.map((rp) => ({ ...rp })),
    auditLogs: []
  };
}

export function getState(): State {
  return state;
}

export function findUserByEmail(email: string): MockUser | undefined {
  for (const user of state.users.values()) {
    if (user.email === email && !user.deletedAt) return user;
  }
  return undefined;
}

export function findUserById(id: string): MockUser | undefined {
  const user = state.users.get(id);
  return user && !user.deletedAt ? user : undefined;
}

export function findUserByIdWithDeleted(id: string): MockUser | undefined {
  return state.users.get(id);
}

export function toUserResponse(user: MockUser): UserResponse {
  const { password: _, tokenRevokedAt: __, ...response } = user;
  return response;
}

export function addOAuthAccounts(
  userId: string,
  accounts: OAuthAccount[]
): void {
  const existing = state.oauthAccounts.get(userId) || [];
  state.oauthAccounts.set(userId, [...existing, ...accounts]);
}

export function logAudit(
  action: string,
  opts: {
    actorId?: string | null;
    actorEmail?: string | null;
    targetId?: string | null;
    targetType?: string | null;
    details?: Record<string, unknown> | null;
    ip?: string;
    requestId?: string;
  } = {}
): void {
  const entry: MockAuditLog = {
    id: crypto.randomUUID(),
    action,
    actorId: opts.actorId ?? null,
    actorEmail: opts.actorEmail ?? null,
    targetId: opts.targetId ?? null,
    targetType: opts.targetType ?? null,
    details: opts.details ?? null,
    ipAddress: opts.ip ?? null,
    requestId: opts.requestId ?? null,
    createdAt: new Date().toISOString()
  };
  state.auditLogs.push(entry);
}

type Actions =
  | 'manage'
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'list'
  | 'search'
  | 'assign';
type Subjects = 'User' | 'Role' | 'Permission' | 'Profile' | 'all';
type MockAbility = MongoAbility<[Actions, Subjects]>;

const SUBJECT_MAP: Partial<Record<string, Subjects>> = {
  users: 'User',
  roles: 'Role',
  permissions: 'Permission',
  profile: 'Profile'
};

export function getPackedRulesForUser(user: MockUser): unknown[][] {
  const { can, build } = new AbilityBuilder<MockAbility>(createMongoAbility);

  if (user.roles?.includes('admin')) {
    can('manage', 'all');
    return packRules(build().rules);
  }

  const currentState = getState();

  // Find role IDs for this user's role names
  const roleIds: string[] = [];
  for (const [id, role] of currentState.roles) {
    if (user.roles.includes(role.name)) {
      roleIds.push(id);
    }
  }

  // Collect resolved permissions — deduplicated by resource:action, first wins
  const permissionMap = new Map<
    string,
    { resource: string; action: string; conditions: PermissionCondition | null }
  >();

  for (const roleId of roleIds) {
    for (const rp of currentState.rolePermissions.filter(
      (p) => p.roleId === roleId
    )) {
      const permission = currentState.permissions.get(rp.permissionId);
      if (!permission) continue;
      const key = `${permission.resource}:${permission.action}`;
      if (!permissionMap.has(key)) {
        permissionMap.set(key, {
          resource: permission.resource,
          action: permission.action,
          conditions: rp.conditions
        });
      }
    }
  }

  // Build CASL abilities — mirrors casl-ability.factory.ts logic
  for (const { resource, action, conditions } of permissionMap.values()) {
    const subject = SUBJECT_MAP[resource];
    if (!subject) continue;

    if (!conditions) {
      can(action as Actions, subject);
      continue;
    }

    const query: Record<string, unknown> = {};

    if (conditions.ownership) {
      query[conditions.ownership.userField] = user.id;
    }

    if (conditions.fieldMatch) {
      for (const [field, values] of Object.entries(conditions.fieldMatch)) {
        if (Array.isArray(values) && values.length > 0) {
          query[field] = { $in: values };
        }
      }
    }

    if (conditions.userAttr) {
      const userContext: Record<string, unknown> = { id: user.id };
      for (const [field, attrName] of Object.entries(conditions.userAttr)) {
        if (typeof attrName === 'string' && attrName in userContext) {
          query[field] = userContext[attrName];
        }
      }
    }

    if (conditions.custom) {
      try {
        const parsed = JSON.parse(conditions.custom) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) {
          query[k] = v;
        }
      } catch {
        // ignore invalid JSON — same as server behaviour
      }
    }

    if (Object.keys(query).length > 0) {
      // CASL infers MongoQuery<never> for string subjects — cast is required
      can(action as Actions, subject, query as MongoQuery<never>);
    } else {
      can(action as Actions, subject);
    }
  }

  return packRules(build().rules);
}

// Initialize on import
resetState();
