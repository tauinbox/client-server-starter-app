import { faker } from '@faker-js/faker';
import {
  BILLING_CONFIGURED_ATTRIBUTE,
  BILLING_FLAG_KEY,
  BILLING_PROVIDER_FLAGS,
  OAUTH_PROVIDER_FLAGS
} from '@app/shared/constants';
import { createMockUser, createOAuthAccount } from './factories';
import type {
  MockUser,
  OAuthAccount,
  MockRole,
  MockPermission,
  MockRolePermission,
  MockResource,
  MockAction,
  MockFeatureFlag,
  MockFeatureFlagRule,
  MockPlan,
  MockProduct
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
      locale: 'en',
      failedLoginAttempts: 0,
      lockedUntil: null,
      tokenRevokedAt: null,
      pendingEmail: null,
      pendingEmailToken: null,
      pendingEmailExpiresAt: null,
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
      locale: 'en',
      failedLoginAttempts: 0,
      lockedUntil: null,
      tokenRevokedAt: null,
      pendingEmail: null,
      pendingEmailToken: null,
      pendingEmailExpiresAt: null,
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
      locale: 'en',
      failedLoginAttempts: 0,
      lockedUntil: null,
      tokenRevokedAt: null,
      pendingEmail: null,
      pendingEmailToken: null,
      pendingEmailExpiresAt: null,
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
      locale: 'en',
      failedLoginAttempts: 0,
      lockedUntil: null,
      tokenRevokedAt: null,
      pendingEmail: null,
      pendingEmailToken: null,
      pendingEmailExpiresAt: null,
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
      locale: 'en',
      failedLoginAttempts: 0,
      lockedUntil: null,
      tokenRevokedAt: null,
      pendingEmail: null,
      pendingEmailToken: null,
      pendingEmailExpiresAt: null,
      createdAt: '2025-04-01T00:00:00.000Z',
      updatedAt: '2025-04-01T00:00:00.000Z',
      deletedAt: null
    }
  ];

  // A spread of single- and multi-role combinations so the user list shows
  // every chip variant: one role, two roles, and "+N" overflow with a tooltip.
  // Custom roles only (plus the base "user") — the "admin" role stays limited
  // to the every-20th user below so role-filter expectations don't shift.
  const roleCombos: string[][] = [
    ['user'],
    ['user', 'editor'],
    ['user', 'support'],
    ['user', 'editor', 'moderator'],
    ['user', 'support', 'auditor'],
    ['user', 'moderator', 'auditor'],
    ['editor', 'support'],
    ['user', 'editor', 'moderator', 'auditor']
  ];

  const generated: MockUser[] = [];
  for (let i = 0; i < 65; i++) {
    const combo = i % 20 === 0 ? ['admin'] : roleCombos[i % roleCombos.length];
    generated.push(
      createMockUser({
        id: String(i + 6),
        isActive: i % 5 !== 0,
        roles: [...combo]
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
      isRegistered: true,
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
      isRegistered: true,
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
      isRegistered: true,
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
      isRegistered: true,
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
    },
    {
      id: 'role-editor',
      name: 'editor',
      description: 'Can create and edit content',
      isSystem: false,
      isSuper: false,
      createdAt: '2025-01-02T00:00:00.000Z',
      updatedAt: '2025-01-02T00:00:00.000Z'
    },
    {
      id: 'role-moderator',
      name: 'moderator',
      description: 'Moderates user-generated content',
      isSystem: false,
      isSuper: false,
      createdAt: '2025-01-03T00:00:00.000Z',
      updatedAt: '2025-01-03T00:00:00.000Z'
    },
    {
      id: 'role-support',
      name: 'support',
      description: 'Handles customer support requests',
      isSystem: false,
      isSuper: false,
      createdAt: '2025-01-04T00:00:00.000Z',
      updatedAt: '2025-01-04T00:00:00.000Z'
    },
    {
      id: 'role-auditor',
      name: 'auditor',
      description: 'Read-only access to audit logs',
      isSystem: false,
      isSuper: false,
      createdAt: '2025-01-05T00:00:00.000Z',
      updatedAt: '2025-01-05T00:00:00.000Z'
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

function generateFeatureFlags(): MockFeatureFlag[] {
  const now = '2025-01-01T00:00:00.000Z';
  return [
    {
      id: 'flag-new-dashboard',
      key: 'new-dashboard',
      description: 'Hidden behind a flag while in development',
      enabled: false,
      environments: [],
      public: false,
      version: 1,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'flag-beta-export',
      key: 'beta-export',
      description: 'Beta export rolled out to a 10% sample of users',
      enabled: true,
      environments: [],
      public: false,
      version: 1,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now
    },
    // One public flag per OAuth provider, gated by an attribute rule (below) on
    // the provider's "configured" signal. The mock environment marks every
    // provider configured, so all three buttons show in dev / E2E.
    ...OAUTH_PROVIDER_FLAGS.map(({ provider, flagKey }) => ({
      id: `flag-${flagKey}`,
      key: flagKey,
      description: `Show the ${provider} OAuth login button (gated by provider configuration)`,
      enabled: true,
      environments: [],
      public: true,
      version: 1,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now
    })),
    // Public `billing` flag gated (rule below) on the `billingConfigured`
    // signal — the mock marks every provider configured, so billing UI shows in
    // dev / E2E.
    {
      id: `flag-${BILLING_FLAG_KEY}`,
      key: BILLING_FLAG_KEY,
      description:
        'Show billing (gated by at least one provider being configured)',
      enabled: true,
      environments: [],
      public: true,
      version: 1,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now
    },
    // Per-provider admin kill-switches consumed by the geo-router. Enabled here
    // (unlike the real server's disabled default) so checkout flows resolve a
    // provider in E2E.
    ...BILLING_PROVIDER_FLAGS.map(({ provider, enabledFlagKey }) => ({
      id: `flag-${enabledFlagKey}`,
      key: enabledFlagKey,
      description: `Admin kill-switch enabling the ${provider} billing provider`,
      enabled: true,
      environments: [],
      public: false,
      version: 1,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now
    }))
  ];
}

function generateFeatureFlagRules(): MockFeatureFlagRule[] {
  const now = '2025-01-01T00:00:00.000Z';
  return [
    {
      id: 'rule-beta-export-percent',
      flagId: 'flag-beta-export',
      type: 'percentage',
      effect: 'include',
      payload: { type: 'percentage', percent: 10 },
      createdAt: now,
      updatedAt: now
    },
    ...OAUTH_PROVIDER_FLAGS.map(({ flagKey, attributeKey }) => ({
      id: `rule-${flagKey}-configured`,
      flagId: `flag-${flagKey}`,
      type: 'attribute' as const,
      effect: 'include' as const,
      payload: {
        type: 'attribute' as const,
        field: 'custom' as const,
        op: 'eq' as const,
        value: true,
        customKey: attributeKey
      },
      createdAt: now,
      updatedAt: now
    })),
    {
      id: `rule-${BILLING_FLAG_KEY}-configured`,
      flagId: `flag-${BILLING_FLAG_KEY}`,
      type: 'attribute' as const,
      effect: 'include' as const,
      payload: {
        type: 'attribute' as const,
        field: 'custom' as const,
        op: 'eq' as const,
        value: true,
        customKey: BILLING_CONFIGURED_ATTRIBUTE
      },
      createdAt: now,
      updatedAt: now
    }
  ];
}

export const seedFeatureFlags: MockFeatureFlag[] = generateFeatureFlags();
export const seedFeatureFlagRules: MockFeatureFlagRule[] =
  generateFeatureFlagRules();

// Billing plan catalog — mirrors server/src/seeders/billing-plans.seeder.ts:
// Free/Pro/Business (fixed) + the `usage` tier. Two prices per tier
// (RUB via YooKassa, USD via Paddle) in minor units.
function generatePlans(): MockPlan[] {
  const now = '2025-01-01T00:00:00.000Z';
  const base = {
    interval: 'month' as const,
    trialDays: 0,
    createdAt: now,
    updatedAt: now
  };
  return [
    {
      ...base,
      id: 'plan-free',
      key: 'free',
      name: 'Free',
      description: 'Core access at no cost',
      billingMode: 'fixed',
      meterKey: null,
      entitlements: [],
      limits: null,
      active: true,
      prices: {
        yookassa: { currency: 'RUB', amountMinor: 0 },
        paddle: { currency: 'USD', amountMinor: 0 }
      }
    },
    {
      ...base,
      id: 'plan-pro',
      key: 'pro',
      name: 'Pro',
      description: 'For growing teams',
      billingMode: 'fixed',
      meterKey: null,
      entitlements: ['reports', 'api-access', 'data-export'],
      limits: { records: 10000 },
      active: true,
      prices: {
        yookassa: { currency: 'RUB', amountMinor: 99000 },
        paddle: { currency: 'USD', amountMinor: 1200 }
      }
    },
    {
      ...base,
      id: 'plan-business',
      key: 'business',
      name: 'Business',
      description: 'Advanced limits and priority support',
      billingMode: 'fixed',
      meterKey: null,
      entitlements: [
        'reports',
        'api-access',
        'data-export',
        'priority-support'
      ],
      limits: { records: 100000 },
      active: true,
      prices: {
        yookassa: { currency: 'RUB', amountMinor: 290000 },
        paddle: { currency: 'USD', amountMinor: 2900 }
      }
    },
    {
      ...base,
      id: 'plan-usage',
      key: 'usage',
      name: 'Pay as you go',
      description: 'Pay only for what you use',
      billingMode: 'usage',
      meterKey: 'api_calls',
      entitlements: ['reports', 'api-access'],
      limits: null,
      active: true,
      prices: {
        yookassa: {
          currency: 'RUB',
          amountMinor: 0,
          unitPriceMinor: 200,
          includedUnits: 0
        },
        paddle: {
          currency: 'USD',
          amountMinor: 0,
          unitPriceMinor: 2,
          includedUnits: 0
        }
      }
    }
  ];
}

export const seedPlans: MockPlan[] = generatePlans();

// One-time purchase catalog — mirrors server/src/seeders/billing-products.seeder.ts:
// a fixed-price sku unlocking the `reports` entitlement for 30 days, and a
// bounded custom-amount donation (no grant).
function generateProducts(): MockProduct[] {
  const now = '2025-01-01T00:00:00.000Z';
  return [
    {
      id: 'prod-report-pack',
      key: 'report-pack',
      name: 'Report pack',
      description: '30 days of reports access without a subscription',
      type: 'sku',
      prices: {
        yookassa: { currency: 'RUB', amountMinor: 49000 },
        paddle: { currency: 'USD', amountMinor: 500 }
      },
      grant: { entitlement: 'reports', durationDays: 30 },
      active: true,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'prod-donation',
      key: 'donation',
      name: 'Donation',
      description: 'Support the project with any amount',
      type: 'custom',
      prices: {
        yookassa: {
          currency: 'RUB',
          minAmountMinor: 10000,
          maxAmountMinor: 5000000
        },
        paddle: { currency: 'USD', minAmountMinor: 100, maxAmountMinor: 50000 }
      },
      grant: null,
      active: true,
      createdAt: now,
      updatedAt: now
    }
  ];
}

export const seedProducts: MockProduct[] = generateProducts();
