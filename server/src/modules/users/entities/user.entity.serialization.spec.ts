import { instanceToPlain } from 'class-transformer';
import { User } from './user.entity';
import { Role } from '../../auth/entities/role.entity';

// Regression for BKL-006: sensitive fields must be hidden from non-privileged
// callers. lockedUntil and Role.isSystem/isSuper are gated by the 'privileged'
// class-transformer group; failedLoginAttempts is fully @Exclude()-d.
//
// Verifies the entity-level decorators behave as the AuthController (no group)
// and UsersController/RolesController (group: ['privileged']) configurations
// expect — without booting a full HTTP server.

function createRole(overrides: Partial<Role> = {}): Role {
  return Object.assign(new Role(), {
    id: 'role-1',
    name: 'admin',
    description: 'Administrator',
    isSystem: true,
    isSuper: true,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    rolePermissions: [],
    users: [],
    ...overrides
  });
}

function createUser(overrides: Partial<User> = {}): User {
  return Object.assign(new User(), {
    id: 'user-1',
    email: 'user@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    password: '$2b$10$hashed',
    isActive: true,
    isEmailVerified: true,
    failedLoginAttempts: 3,
    lockedUntil: new Date('2025-01-02T00:00:00Z'),
    emailVerificationToken: 'evt',
    emailVerificationExpiresAt: new Date('2025-01-03T00:00:00Z'),
    passwordResetToken: 'prt',
    passwordResetExpiresAt: new Date('2025-01-04T00:00:00Z'),
    tokenRevokedAt: new Date('2025-01-05T00:00:00Z'),
    roles: [createRole()],
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides
  });
}

describe('User entity serialization (BKL-006 regression)', () => {
  describe('public form (AuthController — no groups)', () => {
    it('hides failedLoginAttempts (always @Exclude()d)', () => {
      const plain = instanceToPlain(createUser());
      expect(plain).not.toHaveProperty('failedLoginAttempts');
    });

    it('hides lockedUntil (gated by privileged group)', () => {
      const plain = instanceToPlain(createUser());
      expect(plain).not.toHaveProperty('lockedUntil');
    });

    it('hides password and other @Exclude()d secrets', () => {
      const plain = instanceToPlain(createUser());
      expect(plain).not.toHaveProperty('password');
      expect(plain).not.toHaveProperty('emailVerificationToken');
      expect(plain).not.toHaveProperty('emailVerificationExpiresAt');
      expect(plain).not.toHaveProperty('passwordResetToken');
      expect(plain).not.toHaveProperty('passwordResetExpiresAt');
      expect(plain).not.toHaveProperty('tokenRevokedAt');
    });

    it('hides Role.isSystem and Role.isSuper on nested roles', () => {
      const plain = instanceToPlain(createUser()) as { roles: object[] };
      expect(plain.roles).toHaveLength(1);
      expect(plain.roles[0]).not.toHaveProperty('isSystem');
      expect(plain.roles[0]).not.toHaveProperty('isSuper');
    });

    it('keeps the public Role fields', () => {
      const plain = instanceToPlain(createUser()) as {
        roles: { id: string; name: string; description: string | null }[];
      };
      expect(plain.roles[0]).toMatchObject({
        id: 'role-1',
        name: 'admin',
        description: 'Administrator'
      });
    });
  });

  describe("privileged form (UsersController — groups: ['privileged'])", () => {
    const opts = { groups: ['privileged'] };

    it('exposes lockedUntil', () => {
      const plain = instanceToPlain(createUser(), opts);
      expect(plain).toHaveProperty('lockedUntil');
    });

    it('still hides failedLoginAttempts (always @Exclude()d)', () => {
      const plain = instanceToPlain(createUser(), opts);
      expect(plain).not.toHaveProperty('failedLoginAttempts');
    });

    it('exposes Role.isSystem and Role.isSuper on nested roles', () => {
      const plain = instanceToPlain(createUser(), opts) as {
        roles: { isSystem: boolean; isSuper: boolean }[];
      };
      expect(plain.roles[0].isSystem).toBe(true);
      expect(plain.roles[0].isSuper).toBe(true);
    });
  });
});
