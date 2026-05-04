// Integration regression for BKL-006b — admin email change must reset
// isEmailVerified, issue a fresh verification token, and dispatch the email.

import { Test } from '@nestjs/testing';
import { HttpStatus, HttpException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from '../src/modules/users/services/users.service';
import { MailService } from '../src/modules/mail/mail.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { User } from '../src/modules/users/entities/user.entity';

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
  u.emailVerificationToken = null;
  u.emailVerificationExpiresAt = null;
  u.failedLoginAttempts = 0;
  u.lockedUntil = null;
  u.tokenRevokedAt = null;
  u.roles = [];
  return u;
}

function makeUserRepoMock(store: UserStore) {
  return {
    findOne: jest.fn(
      (opts: {
        where: { id?: string; email?: string };
      }): Promise<User | null> => {
        const { where } = opts;
        if (where.id) return Promise.resolve(store.rows.get(where.id) ?? null);
        if (where.email) {
          for (const row of store.rows.values()) {
            if (row.email === where.email) return Promise.resolve(row);
          }
        }
        return Promise.resolve(null);
      }
    ),
    merge: jest.fn(
      (target: User, partial: Partial<User>): User =>
        Object.assign(target, partial)
    ),
    save: jest.fn((entity: User): Promise<User> => {
      store.rows.set(entity.id, entity);
      return Promise.resolve(entity);
    })
  };
}

describe('UsersService.update — email change side effects (BKL-006b)', () => {
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
    }).compile();

    usersService = moduleRef.get(UsersService);
  });

  it('resets isEmailVerified, persists a hashed verification token and triggers MailService', async () => {
    const updated = await usersService.update('user-1', {
      email: 'after@example.com'
    });

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
      expect.any(String)
    );
  });

  it('does not touch verification fields when email is unchanged', async () => {
    const updated = await usersService.update('user-1', {
      email: 'before@example.com',
      firstName: 'Updated'
    });

    expect(updated.isEmailVerified).toBe(true);
    expect(updated.emailVerificationToken).toBeNull();
    expect(mailService.sendEmailVerification).not.toHaveBeenCalled();
  });

  it('throws 409 with EMAIL_EXISTS errorKey + field=email on duplicate (no MailService side effect)', async () => {
    const dupe = buildSeedUser();
    dupe.id = 'user-2';
    dupe.email = 'taken@example.com';
    store.rows.set('user-2', dupe);

    let caught: unknown;
    try {
      await usersService.update('user-1', { email: 'taken@example.com' });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(HttpStatus.CONFLICT);
    expect((caught as HttpException).getResponse()).toMatchObject({
      errorKey: 'errors.users.emailExists',
      field: 'email'
    });
    expect(mailService.sendEmailVerification).not.toHaveBeenCalled();

    // Original record untouched
    expect(store.rows.get('user-1')?.email).toBe('before@example.com');
    expect(store.rows.get('user-1')?.isEmailVerified).toBe(true);
  });
});
