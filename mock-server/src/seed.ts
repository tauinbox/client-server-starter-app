import { faker } from '@faker-js/faker';
import { createMockUser, createOAuthAccount } from './factories';
import type {
  MockUser,
  OAuthAccount,
  MockRole,
  MockPermission,
  MockRolePermission,
  MockResource,
  MockAction
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

function generateResources(): MockResource[] {
  const now = '2025-01-01T00:00:00.000Z';
  return [
    {
      id: 'res-users',
      name: 'users',
      subject: 'User',
      displayName: 'Users',
      description: 'User management',
      isSystem: true,
      isOrphaned: false,
      allowedActionNames: null,
      lastSyncedAt: now,
      createdAt: now
    },
    {
      id: 'res-profile',
      name: 'profile',
      subject: 'Profile',
      displayName: 'Profile',
      description: 'User profile',
      isSystem: true,
      isOrphaned: false,
      allowedActionNames: ['read', 'update'],
      lastSyncedAt: now,
      createdAt: now
    },
    {
      id: 'res-roles',
      name: 'roles',
      subject: 'Role',
      displayName: 'Roles',
      description: 'Role management',
      isSystem: true,
      isOrphaned: false,
      allowedActionNames: [
        'create',
        'read',
        'update',
        'delete',
        'search',
        'assign'
      ],
      lastSyncedAt: now,
      createdAt: now
    },
    {
      id: 'res-permissions',
      name: 'permissions',
      subject: 'Permission',
      displayName: 'Permissions',
      description: 'Permission management',
      isSystem: true,
      isOrphaned: false,
      allowedActionNames: null,
      lastSyncedAt: now,
      createdAt: now
    }
  ];
}

function generateActions(): MockAction[] {
  const now = '2025-01-01T00:00:00.000Z';
  return [
    {
      id: 'act-create',
      name: 'create',
      displayName: 'Create',
      description: 'Create new records',
      isDefault: true,
      createdAt: now
    },
    {
      id: 'act-read',
      name: 'read',
      displayName: 'Read',
      description: 'View records',
      isDefault: true,
      createdAt: now
    },
    {
      id: 'act-update',
      name: 'update',
      displayName: 'Update',
      description: 'Modify existing records',
      isDefault: true,
      createdAt: now
    },
    {
      id: 'act-delete',
      name: 'delete',
      displayName: 'Delete',
      description: 'Remove records',
      isDefault: true,
      createdAt: now
    },
    {
      id: 'act-search',
      name: 'search',
      displayName: 'Search',
      description: 'Search and list records',
      isDefault: true,
      createdAt: now
    },
    {
      id: 'act-assign',
      name: 'assign',
      displayName: 'Assign',
      description: 'Assign associations',
      isDefault: false,
      createdAt: now
    }
  ];
}

function generateRoles(): MockRole[] {
  return [
    {
      id: 'role-admin',
      name: 'admin',
      description: 'System administrator with full access',
      isSystem: true,
      isSuper: true,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    },
    {
      id: 'role-user',
      name: 'user',
      description: 'Regular user with basic access',
      isSystem: true,
      isSuper: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z'
    }
  ];
}

function generatePermissions(
  resources: MockResource[],
  actions: MockAction[]
): MockPermission[] {
  const now = '2025-01-01T00:00:00.000Z';
  const perms: MockPermission[] = [];
  let id = 1;

  for (const resource of resources) {
    for (const action of actions) {
      perms.push({
        id: `perm-${id++}`,
        resourceId: resource.id,
        actionId: action.id,
        description: `${action.displayName} ${resource.displayName}`,
        createdAt: now
      });
    }
  }

  return perms;
}

function generateRolePermissions(
  roles: MockRole[],
  permissions: MockPermission[],
  resources: MockResource[]
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
    const profileResource = resources.find((r) => r.name === 'profile');
    if (profileResource) {
      for (const perm of permissions.filter(
        (p) => p.resourceId === profileResource.id
      )) {
        result.push({
          id: `rp-${id++}`,
          roleId: userRole.id,
          permissionId: perm.id,
          conditions: null
        });
      }
    }
  }

  return result;
}

export const seedUsers: MockUser[] = generateUsers();
export const seedOAuthAccounts: Map<string, OAuthAccount[]> =
  generateOAuthAccounts();
export const seedResources: MockResource[] = generateResources();
export const seedActions: MockAction[] = generateActions();
export const seedRoles: MockRole[] = generateRoles();
export const seedPermissions: MockPermission[] = generatePermissions(
  seedResources,
  seedActions
);
export const seedRolePermissions: MockRolePermission[] =
  generateRolePermissions(seedRoles, seedPermissions, seedResources);
