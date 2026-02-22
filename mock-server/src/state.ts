import type { ResolvedPermission } from '@app/shared/types';
import { PERMISSIONS } from '@app/shared/constants';
import type { MockUser, OAuthAccount, State } from './types';
import { seedOAuthAccounts, seedUsers } from './seed';

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
    passwordResetTokens: new Map()
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

const ALL_PERMISSIONS: ResolvedPermission[] = Object.values(PERMISSIONS).map(
  (p) => {
    const [resource, action] = p.split(':');
    return { resource, action, permission: p, conditions: null };
  }
);

const USER_PERMISSIONS: ResolvedPermission[] = ALL_PERMISSIONS.filter(
  (p) => p.resource === 'profile'
);

export function getPermissionsForUser(user: MockUser): ResolvedPermission[] {
  if (user.roles?.includes('admin')) {
    return ALL_PERMISSIONS;
  }
  return USER_PERMISSIONS;
}

// Initialize on import
resetState();
