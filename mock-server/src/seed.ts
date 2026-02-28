import { faker } from '@faker-js/faker';
import { createMockUser, createOAuthAccount } from './factories';
import type {
  MockUser,
  OAuthAccount,
  MockRole,
  MockPermission,
  MockRolePermission
} from './types';

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
      roles: ['admin'],
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      tokenRevokedAt: null,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      deletedAt: null
    },
    {
      id: '2',
      email: 'user@example.com',
      firstName: 'Regular',
      lastName: 'User',
      password: 'Password1',
      isActive: true,
      roles: ['user'],
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      tokenRevokedAt: null,
      createdAt: '2025-01-15T00:00:00.000Z',
      updatedAt: '2025-01-15T00:00:00.000Z',
      deletedAt: null
    },
    {
      id: '3',
      email: 'john@example.com',
      firstName: 'John',
      lastName: 'Smith',
      password: 'Password1',
      isActive: true,
      roles: ['user'],
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      tokenRevokedAt: null,
      createdAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2025-02-01T00:00:00.000Z',
      deletedAt: null
    },
    {
      id: '4',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      password: 'Password1',
      isActive: false,
      roles: ['user'],
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      tokenRevokedAt: null,
      createdAt: '2025-03-01T00:00:00.000Z',
      updatedAt: '2025-03-01T00:00:00.000Z',
      deletedAt: null
    },
    {
      id: '5',
      email: 'bob@example.com',
      firstName: 'Bob',
      lastName: 'Wilson',
      password: 'Password1',
      isActive: true,
      roles: ['user'],
      isEmailVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      tokenRevokedAt: null,
      createdAt: '2025-04-01T00:00:00.000Z',
      updatedAt: '2025-04-01T00:00:00.000Z',
      deletedAt: null
    }
  ];

  const generated: MockUser[] = [];
  for (let i = 0; i < 65; i++) {
    const roles = i % 20 === 0 ? ['admin'] : ['user'];
    generated.push(
      createMockUser({
        id: String(i + 6),
        isActive: i % 5 !== 0,
        roles
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

function generateRoles(): MockRole[] {
  return [
    {
      id: 'role-admin',
      name: 'admin',
      description: 'System administrator with full access',
      isSystem: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    },
    {
      id: 'role-user',
      name: 'user',
      description: 'Regular user with basic access',
      isSystem: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    }
  ];
}

function generatePermissions(): MockPermission[] {
  const now = '2025-01-01T00:00:00.000Z';
  const perms: Array<[string, string, string]> = [
    ['users', 'create', 'Create new users'],
    ['users', 'read', 'View user details'],
    ['users', 'update', 'Update user information'],
    ['users', 'delete', 'Delete users'],
    ['users', 'list', 'List all users'],
    ['users', 'search', 'Search users'],
    ['profile', 'read', 'View own profile'],
    ['profile', 'update', 'Update own profile'],
    ['roles', 'create', 'Create new roles'],
    ['roles', 'read', 'View roles'],
    ['roles', 'update', 'Update roles'],
    ['roles', 'delete', 'Delete roles'],
    ['roles', 'assign', 'Assign roles to users']
  ];

  return perms.map(([resource, action, description], i) => ({
    id: `perm-${i + 1}`,
    resource,
    action,
    description,
    createdAt: now
  }));
}

function generateRolePermissions(
  roles: MockRole[],
  permissions: MockPermission[]
): MockRolePermission[] {
  const result: MockRolePermission[] = [];
  const adminRole = roles.find((r) => r.name === 'admin');
  const userRole = roles.find((r) => r.name === 'user');
  let id = 1;

  // Admin gets all permissions
  if (adminRole) {
    for (const perm of permissions) {
      result.push({
        id: `rp-${id++}`,
        roleId: adminRole.id,
        permissionId: perm.id,
        conditions: null
      });
    }
  }

  // User gets profile permissions only
  if (userRole) {
    for (const perm of permissions.filter((p) => p.resource === 'profile')) {
      result.push({
        id: `rp-${id++}`,
        roleId: userRole.id,
        permissionId: perm.id,
        conditions: null
      });
    }
  }

  return result;
}

export const seedUsers: MockUser[] = generateUsers();
export const seedOAuthAccounts: Map<string, OAuthAccount[]> =
  generateOAuthAccounts();
export const seedRoles: MockRole[] = generateRoles();
export const seedPermissions: MockPermission[] = generatePermissions();
export const seedRolePermissions: MockRolePermission[] =
  generateRolePermissions(seedRoles, seedPermissions);
