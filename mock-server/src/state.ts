import {
  AbilityBuilder,
  createMongoAbility,
  MongoAbility
} from '@casl/ability';
import type { MongoQuery } from '@casl/ability';
import { packRules } from '@casl/ability/extra';
import type {
  AdminUserResponse,
  MockAuditLog,
  MockPermission,
  MockUser,
  OAuthAccount,
  State,
  UserResponse
} from './types';
import type {
  PermissionResponse,
  ResolvedPermission,
  ResourceResponse,
  ActionResponse,
  RoleResponse,
  RoleAdminResponse
} from '@app/shared/types';
import { findDeniedMongoKey } from '@app/shared/utils/mongo-query-safety';
import {
  seedOAuthAccounts,
  seedUsers,
  seedResources,
  seedActions,
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
    revokedRefreshTokens: new Map(),
    emailVerificationTokens: new Map(),
    passwordResetTokens: new Map(),
    resources: new Map(seedResources.map((r) => [r.id, { ...r }])),
    actions: new Map(seedActions.map((a) => [a.id, { ...a }])),
    roles: new Map(seedRoles.map((r) => [r.id, { ...r }])),
    permissions: new Map(seedPermissions.map((p) => [p.id, { ...p }])),
    rolePermissions: seedRolePermissions.map((rp) => ({ ...rp })),
    auditLogs: [],
    captchaConfig: { enabled: false, siteKey: null },
    captchaAttempts: new Map()
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

export function toResourceResponse(resource: {
  id: string;
  name: string;
  subject: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  isOrphaned: boolean;
  isRegistered: boolean;
  allowedActionNames: string[] | null;
  createdAt: string;
}): ResourceResponse {
  return {
    id: resource.id,
    name: resource.name,
    subject: resource.subject,
    displayName: resource.displayName,
    description: resource.description,
    isSystem: resource.isSystem,
    isOrphaned: resource.isOrphaned,
    isRegistered: resource.isRegistered,
    allowedActionNames: resource.allowedActionNames,
    createdAt: resource.createdAt
  };
}

export function toActionResponse(action: {
  id: string;
  name: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  createdAt: string;
}): ActionResponse {
  return {
    id: action.id,
    name: action.name,
    displayName: action.displayName,
    description: action.description,
    isDefault: action.isDefault,
    createdAt: action.createdAt
  };
}

export function toPermissionResponse(
  perm: MockPermission
): PermissionResponse | null {
  const resource = state.resources.get(perm.resourceId);
  const action = state.actions.get(perm.actionId);
  if (!resource || !action) return null;

  return {
    id: perm.id,
    resource: toResourceResponse(resource),
    action: toActionResponse(action),
    description: perm.description,
    createdAt: perm.createdAt
  };
}

function toRolePublicResponse(role: {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}): RoleResponse {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt
  };
}

function toRoleAdminResponse(role: {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isSuper: boolean;
  createdAt: string;
  updatedAt: string;
}): RoleAdminResponse {
  return {
    ...toRolePublicResponse(role),
    isSystem: role.isSystem,
    isSuper: role.isSuper
  };
}

export function toUserResponse(user: MockUser): UserResponse {
  const {
    password: _,
    tokenRevokedAt: __,
    failedLoginAttempts: ___,
    lockedUntil: ____,
    roles: roleNames,
    ...rest
  } = user;
  const roles = roleNames.flatMap((name) => {
    const role = Array.from(state.roles.values()).find((r) => r.name === name);
    return role ? [toRolePublicResponse(role)] : [];
  });
  return { ...rest, roles };
}

export function toAdminUserResponse(user: MockUser): AdminUserResponse {
  const {
    password: _,
    tokenRevokedAt: __,
    failedLoginAttempts: ___,
    roles: roleNames,
    ...rest
  } = user;
  const roles = roleNames.flatMap((name) => {
    const role = Array.from(state.roles.values()).find((r) => r.name === name);
    return role ? [toRoleAdminResponse(role)] : [];
  });
  return { ...rest, roles };
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
  | 'search'
  | 'assign';
type Subjects = 'User' | 'Role' | 'Permission' | 'Profile' | 'all';
type MockAbility = MongoAbility<[Actions, Subjects]>;

export function getResolvedPermissionsForUser(
  user: MockUser
): ResolvedPermission[] {
  const currentState = getState();

  const roleIds: string[] = [];
  for (const [id, role] of currentState.roles) {
    if (user.roles.includes(role.name)) {
      roleIds.push(id);
    }
  }

  // Dedup keyed by effect:resource:action, first wins — mirrors
  // PermissionService.getPermissionsForUser on the server.
  const permissionMap = new Map<string, ResolvedPermission>();

  for (const roleId of roleIds) {
    for (const rp of currentState.rolePermissions.filter(
      (p) => p.roleId === roleId
    )) {
      const permission = currentState.permissions.get(rp.permissionId);
      if (!permission) continue;
      const resource = currentState.resources.get(permission.resourceId);
      const action = currentState.actions.get(permission.actionId);
      if (!resource || !action) continue;
      const effect = rp.conditions?.effect === 'deny' ? 'deny' : 'allow';
      const key = `${effect}:${resource.name}:${action.name}`;
      if (!permissionMap.has(key)) {
        permissionMap.set(key, {
          resource: resource.name,
          action: action.name,
          permission: `${resource.name}:${action.name}`,
          conditions: rp.conditions
        });
      }
    }
  }

  return Array.from(permissionMap.values());
}

export function getPackedRulesForUser(user: MockUser): unknown[][] {
  const { can, cannot, build } = new AbilityBuilder<MockAbility>(
    createMongoAbility
  );

  const currentState = getState();

  const hasSuperRole = user.roles.some((roleName) => {
    for (const role of currentState.roles.values()) {
      if (role.name === roleName && role.isSuper) return true;
    }
    return false;
  });

  if (hasSuperRole) {
    can('manage', 'all');
    return packRules(build().rules);
  }

  const subjectMap = new Map<string, string>();
  for (const resource of currentState.resources.values()) {
    subjectMap.set(resource.name, resource.subject);
  }

  const resolved = getResolvedPermissionsForUser(user);

  // Build CASL abilities — mirrors casl-ability.factory.ts logic.
  // Inverted rules (cannot) must come after direct rules (can) in CASL, so
  // partition entries into allow-first / deny-last order.
  const orderedEntries = [
    ...resolved.filter((e) => e.conditions?.effect !== 'deny'),
    ...resolved.filter((e) => e.conditions?.effect === 'deny')
  ];

  for (const { resource, action, conditions } of orderedEntries) {
    const subject = subjectMap.get(resource) as Subjects | undefined;
    if (!subject) continue;

    const isDeny = conditions?.effect === 'deny';
    const register = isDeny ? cannot : can;

    if (!conditions) {
      register(action as Actions, subject);
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
        if (findDeniedMongoKey(parsed)) {
          continue;
        }
        for (const [k, v] of Object.entries(parsed)) {
          query[k] = v;
        }
      } catch {
        // ignore invalid JSON — same as server behaviour
      }
    }

    if (Object.keys(query).length > 0) {
      register(action as Actions, subject, query as MongoQuery<never>);
    } else {
      register(action as Actions, subject);
    }
  }

  return packRules(build().rules);
}

// Initialize on import
resetState();
