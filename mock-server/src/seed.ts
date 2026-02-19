import { faker } from '@faker-js/faker';
import { createMockUser, createOAuthAccount } from './factories';
import type { MockUser, OAuthAccount } from './types';

// Fixed seed for reproducible data across restarts
faker.seed(12345);

function generateUsers(): MockUser[] {
  // Passwords are stored in plaintext (no hashing) — this is intentional
  // for the mock server. The real server uses bcrypt.
  // Well-known users that E2E tests depend on — do not change
  const manual: MockUser[] = [
    {
      id: '1',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      password: 'Password1',
      isActive: true,
      isAdmin: true,
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    },
    {
      id: '2',
      email: 'user@example.com',
      firstName: 'Regular',
      lastName: 'User',
      password: 'Password1',
      isActive: true,
      isAdmin: false,
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: '2025-01-15T00:00:00.000Z',
      updatedAt: '2025-01-15T00:00:00.000Z'
    },
    {
      id: '3',
      email: 'john@example.com',
      firstName: 'John',
      lastName: 'Smith',
      password: 'Password1',
      isActive: true,
      isAdmin: false,
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2025-02-01T00:00:00.000Z'
    },
    {
      id: '4',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      password: 'Password1',
      isActive: false,
      isAdmin: false,
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: '2025-03-01T00:00:00.000Z',
      updatedAt: '2025-03-01T00:00:00.000Z'
    },
    {
      id: '5',
      email: 'bob@example.com',
      firstName: 'Bob',
      lastName: 'Wilson',
      password: 'Password1',
      isActive: true,
      isAdmin: false,
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: '2025-04-01T00:00:00.000Z',
      updatedAt: '2025-04-01T00:00:00.000Z'
    }
  ];

  const generated: MockUser[] = [];
  for (let i = 0; i < 65; i++) {
    generated.push(
      createMockUser({
        id: String(i + 6),
        isActive: i % 5 !== 0,
        isAdmin: i % 20 === 0
      })
    );
  }

  return [...manual, ...generated];
}

function generateOAuthAccounts(): Map<string, OAuthAccount[]> {
  const accounts = new Map<string, OAuthAccount[]>();

  // Admin always has a Google OAuth account
  accounts.set('1', [
    {
      provider: 'google',
      providerId: 'google-admin-123',
      createdAt: '2025-01-01T00:00:00.000Z'
    }
  ]);

  // Add OAuth accounts for ~10 random generated users
  for (let i = 0; i < 10; i++) {
    const userId = String(faker.number.int({ min: 6, max: 70 }));
    if (!accounts.has(userId)) {
      accounts.set(userId, [createOAuthAccount()]);
    }
  }

  return accounts;
}

export const seedUsers: MockUser[] = generateUsers();
export const seedOAuthAccounts: Map<string, OAuthAccount[]> =
  generateOAuthAccounts();
