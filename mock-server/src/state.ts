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

// Initialize on import
resetState();
