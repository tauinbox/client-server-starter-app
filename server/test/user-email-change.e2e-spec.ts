// Integration regression: admin email change must reset isEmailVerified,
// issue a fresh verification token, dispatch the email, and revoke every
// session of the target.

import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus, HttpException } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersController } from '../src/modules/users/controllers/users.controller';
import { MfaRequiredGuard } from '../src/modules/auth/guards/mfa-required.guard';
import { UsersService } from '../src/modules/users/services/users.service';
import { MailService } from '../src/modules/mail/mail.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { BreachedPasswordService } from '../src/modules/auth/breached-password/breached-password.service';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import { CaslAbilityFactory } from '../src/modules/auth/casl/casl-ability.factory';
import { SessionRevocationListener } from '../src/modules/auth/listeners/session-revocation.listener';
import { User } from '../src/modules/users/entities/user.entity';
import type { JwtAuthRequest } from '../src/modules/auth/types/auth.request';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import type { AppAbility } from '../src/modules/auth/casl/app-ability';

interface UserStore {
  rows: Map<string, User>;
}

function createStore(): UserStore {
  return { rows: new Map() };
}

function buildSeedUser(): User {
  const u = new User();
  u.id = 'user-1';
  u.email = 'before@example.com';
  u.firstName = 'Before';
  u.lastName = 'User';
  u.password = '$2b$10$hash';
  u.isActive = true;
  u.isEmailVerified = true;
  u.locale = 'en';
  u.emailVerificationToken = null;
  u.emailVerificationExpiresAt = null;
  u.passwordResetToken = null;
  u.passwordResetExpiresAt = null;
  u.pendingEmail = null;
  u.pendingEmailToken = null;
  u.pendingEmailExpiresAt = null;
  u.failedLoginAttempts = 0;
  u.lockedUntil = null;
  u.tokenRevokedAt = null;
  u.roles = [];
  return u;
}

type WhereClause = {
  id?: string;
  email?: string;
  pendingEmail?: string;
};

function matchOne(row: User, where: WhereClause): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.email !== undefined && row.email !== where.email) return false;
  if (
    where.pendingEmail !== undefined &&
    row.pendingEmail !== where.pendingEmail
  )
    return false;
  return true;
}

function makeUserRepoMock(store: UserStore) {
  return {
    findOne: jest.fn(
      (opts: { where: WhereClause | WhereClause[] }): Promise<User | null> => {
        const clauses = Array.isArray(opts.where) ? opts.where : [opts.where];
        for (const row of store.rows.values()) {
          for (const where of clauses) {
            if (matchOne(row, where)) return Promise.resolve(row);
          }
        }
        return Promise.resolve(null);
      }
    ),
    merge: jest.fn((target: User, partial: Partial<User>): User =>
      Object.assign(target, partial)
    ),
    save: jest.fn((entity: User): Promise<User> => {
      store.rows.set(entity.id, entity);
      return Promise.resolve(entity);
    })
  };
}

describe('UsersService.update — email change side effects', () => {
  let usersService: UsersService;
  let store: UserStore;
  let mailService: { sendEmailVerification: jest.Mock };

  beforeEach(async () => {
    store = createStore();
    store.rows.set('user-1', buildSeedUser());
    mailService = {
      sendEmailVerification: jest.fn().mockResolvedValue(undefined)
    };

    const repo = makeUserRepoMock(store);

    const moduleRef = await Test.createTestingModule({
      providers: [
        {
          provide: BreachedPasswordService,
          useValue: { assertNotBreached: jest.fn() }
        },
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: DataSource, useValue: {} },
        { provide: AuditService, useValue: { logFireAndForget: jest.fn() } },
        {
          provide: MetricsService,
          useValue: { recordPermissionDenied: jest.fn() }
        },
        { provide: MailService, useValue: mailService }
      ]
    })
      .overrideGuard(MfaRequiredGuard)
      .useValue({ canActivate: () => true })
      .compile();

    usersService = moduleRef.get(UsersService);
  });

  it('resets isEmailVerified, persists a hashed verification token and triggers MailService', async () => {
    const updated = await usersService.update(
      'user-1',
      {
        email: 'after@example.com'
      },
      SYSTEM_ABILITY
    );

    expect(updated.email).toBe('after@example.com');
    expect(updated.isEmailVerified).toBe(false);

    const persisted = store.rows.get('user-1');
    expect(persisted?.isEmailVerified).toBe(false);
    expect(persisted?.emailVerificationToken).toEqual(expect.any(String));
    expect(persisted?.emailVerificationToken?.length).toBeGreaterThan(0);
    expect(persisted?.emailVerificationExpiresAt).toBeInstanceOf(Date);

    expect(mailService.sendEmailVerification).toHaveBeenCalledTimes(1);
    expect(mailService.sendEmailVerification).toHaveBeenCalledWith(
      'after@example.com',
      expect.any(String),
      'en'
    );
  });

  it('does not touch verification fields when email is unchanged', async () => {
    const updated = await usersService.update(
      'user-1',
      {
        email: 'before@example.com',
        firstName: 'Updated'
      },
      SYSTEM_ABILITY
    );

    expect(updated.isEmailVerified).toBe(true);
    expect(updated.emailVerificationToken).toBeNull();
    expect(mailService.sendEmailVerification).not.toHaveBeenCalled();
  });

  it('clears self-service pending email fields when admin sets a new email', async () => {
    const u = store.rows.get('user-1')!;
    u.pendingEmail = 'self-service@example.com';
    u.pendingEmailToken = 'hashed-self-service-token';
    u.pendingEmailExpiresAt = new Date(Date.now() + 3600_000);

    await usersService.update(
      'user-1',
      { email: 'admin-set@example.com' },
      SYSTEM_ABILITY
    );

    const persisted = store.rows.get('user-1');
    expect(persisted?.pendingEmail).toBeNull();
    expect(persisted?.pendingEmailToken).toBeNull();
    expect(persisted?.pendingEmailExpiresAt).toBeNull();
  });

  it('rejects when another user holds the address as a pending email change', async () => {
    const dupe = buildSeedUser();
    dupe.id = 'user-3';
    dupe.email = 'other@example.com';
    dupe.pendingEmail = 'reserved@example.com';
    store.rows.set('user-3', dupe);

    let caught: unknown;
    try {
      await usersService.update(
        'user-1',
        { email: 'reserved@example.com' },
        SYSTEM_ABILITY
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
  });

  it('throws 409 with EMAIL_EXISTS errorKey on duplicate (no MailService side effect)', async () => {
    const dupe = buildSeedUser();
    dupe.id = 'user-2';
    dupe.email = 'taken@example.com';
    store.rows.set('user-2', dupe);

    let caught: unknown;
    try {
      await usersService.update(
        'user-1',
        { email: 'taken@example.com' },
        SYSTEM_ABILITY
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
    expect((caught as HttpException).getResponse()).toMatchObject({
      errorKey: 'errors.users.emailExists'
    });
    expect(mailService.sendEmailVerification).not.toHaveBeenCalled();

    // Original record untouched
    expect(store.rows.get('user-1')?.email).toBe('before@example.com');
    expect(store.rows.get('user-1')?.isEmailVerified).toBe(true);
  });
});

// The revocation runs through the real event bus and the real listener, so
// this covers the whole chain the endpoint depends on: an admin email change
// must leave the previous holder with neither a usable access token nor a
// refresh token.
describe('Admin email change - session revocation through the real event bus', () => {
  let module: TestingModule;
  let controller: UsersController;
  let store: UserStore;
  let refreshTokenService: { deleteByUserId: jest.Mock };
  let userUpdate: jest.Mock;

  // @ts-expect-error partial mock - the update path reads only user/ip/headers
  const adminRequest: JwtAuthRequest = {
    user: { userId: 'admin-1', email: 'admin@example.com', roles: [] },
    ip: '127.0.0.1',
    headers: {}
  };

  // @ts-expect-error partial mock - only `can` is exercised by the update path
  const ability: AppAbility = { can: jest.fn().mockReturnValue(true) };

  beforeEach(async () => {
    store = createStore();
    store.rows.set('user-1', buildSeedUser());

    refreshTokenService = {
      deleteByUserId: jest.fn().mockResolvedValue(undefined)
    };
    userUpdate = jest.fn((id: string, patch: Partial<User>) => {
      const row = store.rows.get(id);
      if (row) Object.assign(row, patch);
      return Promise.resolve({});
    });
    const dataSource = {
      getRepository: jest.fn().mockReturnValue({ update: userUpdate })
    };

    module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      controllers: [UsersController],
      providers: [
        {
          provide: BreachedPasswordService,
          useValue: { assertNotBreached: jest.fn() }
        },
        UsersService,
        SessionRevocationListener,
        {
          provide: getRepositoryToken(User),
          useValue: makeUserRepoMock(store)
        },
        { provide: DataSource, useValue: dataSource },
        { provide: RefreshTokenService, useValue: refreshTokenService },
        {
          provide: AuditService,
          useValue: {
            log: jest.fn().mockResolvedValue(undefined),
            logFireAndForget: jest.fn()
          }
        },
        {
          provide: MetricsService,
          useValue: { recordPermissionDenied: jest.fn() }
        },
        {
          provide: MailService,
          useValue: {
            sendEmailVerification: jest.fn().mockResolvedValue(undefined)
          }
        },
        { provide: PermissionService, useValue: {} },
        { provide: CaslAbilityFactory, useValue: {} }
      ]
    })
      .overrideGuard(MfaRequiredGuard)
      .useValue({ canActivate: () => true })
      .compile();

    await module.init();
    controller = module.get(UsersController);
  });

  afterEach(async () => {
    await module.close();
  });

  it('stamps tokenRevokedAt and deletes the refresh tokens of the target', async () => {
    await controller.update(
      'user-1',
      { email: 'after@example.com' },
      adminRequest,
      ability
    );

    expect(store.rows.get('user-1')?.email).toBe('after@example.com');
    expect(refreshTokenService.deleteByUserId).toHaveBeenCalledWith('user-1');
    expect(userUpdate).toHaveBeenCalledWith('user-1', {
      tokenRevokedAt: expect.any(Date) as Date
    });
    expect(store.rows.get('user-1')?.tokenRevokedAt).toBeInstanceOf(Date);
  });

  it('leaves sessions alone when the submitted email is unchanged', async () => {
    await controller.update(
      'user-1',
      { email: 'before@example.com', firstName: 'Updated' },
      adminRequest,
      ability
    );

    expect(refreshTokenService.deleteByUserId).not.toHaveBeenCalled();
    expect(store.rows.get('user-1')?.tokenRevokedAt).toBeNull();
  });
});
