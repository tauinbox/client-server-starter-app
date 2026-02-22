import {
  AbilityBuilder,
  createMongoAbility,
  MongoAbility
} from '@casl/ability';
import type { MongoQuery } from '@casl/ability';
import { packRules } from '@casl/ability/extra';
import type { MockUser, OAuthAccount, State } from './types';
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
    rolePermissions: seedRolePermissions.map((rp) => ({ ...rp }))
  };
}

export function getState(): State {
  return state;
}

export function findUserByEmail(email: string): MockUser | undefined {
  for (const user of state.users.values()) {
    if (user.email === email) return user;
  }
  return undefined;
}

export function findUserById(id: string): MockUser | undefined {
  return state.users.get(id);
}

export function toUserResponse(user: MockUser): Omit<MockUser, 'password'> {
  const { password: _, ...response } = user;
  return response;
}

export function addOAuthAccounts(
  userId: string,
  accounts: OAuthAccount[]
): void {
  const existing = state.oauthAccounts.get(userId) || [];
  state.oauthAccounts.set(userId, [...existing, ...accounts]);
}

type Actions = 'manage' | 'read' | 'update';
type Subjects = 'User' | 'Role' | 'Permission' | 'Profile' | 'all';
type MockAbility = MongoAbility<[Actions, Subjects]>;

export function getPackedRulesForUser(user: MockUser): unknown[][] {
  const { can, build } = new AbilityBuilder<MockAbility>(createMongoAbility);

  if (user.roles?.includes('admin')) {
    can('manage', 'all');
  } else {
    can('read', 'Profile');
    // CASL infers MongoQuery<never> for string subjects — cast is required
    can('update', 'Profile', { id: user.id } as MongoQuery<never>);
  }

  return packRules(build().rules);
}

// Initialize on import
resetState();
