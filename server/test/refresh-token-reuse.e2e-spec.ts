// Integration regression for OAuth 2.0 BCP refresh-token reuse detection (BKL-009).
//
// Wires real AuthService + RefreshTokenService against an in-memory Repository
// stand-in so the full login → rotate → reuse flow runs end-to-end (token
// hashing, transactional revoke + rotate, full session purge on reuse).

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpException, HttpStatus } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { UsersService } from '../src/modules/users/services/users.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { TokenGeneratorService } from '../src/modules/auth/services/token-generator.service';
import { MailService } from '../src/modules/mail/mail.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { User } from '../src/modules/users/entities/user.entity';
import { AuditAction } from '@app/shared/enums/audit-action.enum';

interface InMemoryStore {
  tokens: Map<string, RefreshToken>;
  userRevokedAt: Map<string, Date>;
}

function createStore(): InMemoryStore {
  return { tokens: new Map(), userRevokedAt: new Map() };
}

function makeRefreshTokenRepoMock(store: InMemoryStore) {
  let idSeq = 0;
  const repo = {
    create: (data: Partial<RefreshToken>) => {
      const t = new RefreshToken();
      Object.assign(t, data);
      return t;
    },
    save: jest.fn((entity: RefreshToken) => {
      if (!entity.id) entity.id = `rt-${++idSeq}`;
      if (!entity.createdAt) entity.createdAt = new Date();
      if (entity.revoked === undefined) entity.revoked = false;
      store.tokens.set(entity.id, entity);
      return Promise.resolve(entity);
    }),
    findOne: jest.fn((opts: { where: { token: string } }) => {
      for (const t of store.tokens.values()) {
        if (t.token === opts.where.token) return Promise.resolve(t);
      }
      return Promise.resolve(null);
    }),
    update: jest.fn((id: string, partial: Partial<RefreshToken>) => {
      const existing = store.tokens.get(id);
      if (existing) Object.assign(existing, partial);
      return Promise.resolve({ affected: existing ? 1 : 0 });
    }),
    delete: jest.fn((criteria: { userId: string }) => {
      let n = 0;
      for (const [id, t] of store.tokens.entries()) {
        if (t.userId === criteria.userId) {
          store.tokens.delete(id);
          n++;
        }
      }
      return Promise.resolve({ affected: n });
    }),
    count: jest.fn(() => Promise.resolve(0)),
    createQueryBuilder: jest.fn(() => ({
      delete: () => ({
        from: () => ({
          where: () => ({ execute: () => Promise.resolve({ affected: 0 }) })
        })
      })
    }))
  };
  return repo as unknown as Repository<RefreshToken>;
}

function makeDataSourceMock(
  store: InMemoryStore,
  rtRepo: Repository<RefreshToken>
): DataSource {
  // The transactional manager mirrors the operations AuthService uses: update +
  // save against RefreshToken. Both delegate to the same in-memory store so a
  // committed transaction is observable to subsequent findByToken calls.
  const manager = {
    update: jest.fn(
      (
        _entity: typeof RefreshToken,
        id: string,
        partial: Partial<RefreshToken>
      ) => {
        const existing = store.tokens.get(id);
        if (existing) Object.assign(existing, partial);
        return Promise.resolve({ affected: existing ? 1 : 0 });
      }
    ),
    save: jest.fn((_entity: typeof RefreshToken, data: RefreshToken) =>
      rtRepo.save(data)
    )
  };

  // The User repository only needs update(userId, { tokenRevokedAt }) — no
  // schema enforcement, just a journal of the most recent value.
  const userRepo = {
    update: jest.fn((userId: string, partial: { tokenRevokedAt: Date }) => {
      store.userRevokedAt.set(userId, partial.tokenRevokedAt);
      return Promise.resolve({ affected: 1 });
    })
  };

  return {
    transaction: jest.fn((cb: (m: typeof manager) => Promise<unknown>) =>
      cb(manager)
    ),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === User) return userRepo;
      return rtRepo;
    })
  } as unknown as DataSource;
}

describe('Refresh token reuse detection (e2e — BKL-009)', () => {
  const userRecord: User = {
    id: 'user-1',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Doe',
    password: 'hash',
    isActive: true,
    isEmailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    tokenRevokedAt: null,
    roles: [
      {
        id: 'role-1',
        name: 'user',
        description: null,
        isSystem: true,
        isSuper: false,
        rolePermissions: [],
        users: [],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  } as unknown as User;

  let auth: AuthService;
  let store: InMemoryStore;
  let auditLog: jest.Mock;
  let recordAuthEvent: jest.Mock;

  beforeEach(async () => {
    store = createStore();
    auditLog = jest.fn();
    recordAuthEvent = jest.fn();

    const rtRepo = makeRefreshTokenRepoMock(store);
    const ds = makeDataSourceMock(store, rtRepo);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        RefreshTokenService,
        { provide: getRepositoryToken(RefreshToken), useValue: rtRepo },
        { provide: DataSource, useValue: ds },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
            getOrThrow: jest.fn((k: string) => {
              if (k === 'JWT_REFRESH_EXPIRATION') return '604800';
              throw new Error(`unexpected config key ${k}`);
            })
          }
        },
        {
          provide: UsersService,
          useValue: { findOne: jest.fn().mockResolvedValue(userRecord) }
        },
        { provide: RoleService, useValue: {} },
        {
          provide: TokenGeneratorService,
          useValue: {
            generateTokens: jest.fn((userId: string) => ({
              access_token: `access-${userId}-${Date.now()}-${Math.random()}`,
              refresh_token: `refresh-${userId}-${Date.now()}-${Math.random()}`,
              expires_in: 3600
            }))
          }
        },
        { provide: MailService, useValue: {} },
        {
          provide: AuditService,
          useValue: { log: jest.fn(), logFireAndForget: auditLog }
        },
        { provide: MetricsService, useValue: { recordAuthEvent } }
      ]
    }).compile();

    auth = moduleRef.get(AuthService);
  });

  it('rotates and revokes ALL sessions when the original token is presented twice', async () => {
    // Login — issues an initial refresh token.
    const loginResult = await auth.login(userRecord);
    const originalToken = loginResult.tokens.refresh_token;

    expect(store.tokens.size).toBe(1);

    // First refresh — original token rotates out, a fresh pair is issued.
    const firstRefresh = await auth.refreshTokens(originalToken);
    expect(firstRefresh.tokens.access_token).toBeDefined();
    expect(firstRefresh.tokens.refresh_token).not.toBe(originalToken);

    // The store now holds two RefreshToken rows: the original (revoked) and the new one.
    const rows = Array.from(store.tokens.values());
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.revoked)).toBeDefined();
    expect(rows.find((r) => !r.revoked)).toBeDefined();

    // Second refresh with the SAME original token — reuse detection trips.
    await expect(auth.refreshTokens(originalToken)).rejects.toMatchObject({
      response: { errorKey: 'errors.auth.invalidRefreshToken' }
    });

    // All refresh tokens for the user are gone (deleteByUserId), and the user
    // has tokenRevokedAt set so their access token is invalidated too.
    expect(store.tokens.size).toBe(0);
    expect(store.userRevokedAt.get('user-1')).toBeInstanceOf(Date);

    // Audit row + metric are recorded.
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.TOKEN_REUSE_DETECTED,
        actorId: 'user-1',
        targetId: 'user-1',
        targetType: 'User'
      })
    );
    expect(recordAuthEvent).toHaveBeenCalledWith('token_reuse_detected');

    // A subsequent attempt with the new (post-rotation) token now fails too
    // because all sessions were purged.
    await expect(
      auth.refreshTokens(firstRefresh.tokens.refresh_token)
    ).rejects.toThrow(HttpException);
  });

  it('returns plain 401 (no panic-revoke) for revoked-AND-expired tokens', async () => {
    await auth.login(userRecord);
    const allRows = Array.from(store.tokens.values());
    const row = allRows[0];
    row.revoked = true;
    // Expire the row in the past so isExpired() returns true.
    row.expiresAt = new Date(Date.now() - 60_000);

    // Find the original raw token by looking up the same hash AuthService uses;
    // we can't reverse the hash, so re-issue a known one via direct insert.
    // Simpler: insert a fresh revoked-and-expired token tied to a known raw value.
    const { hashToken } = await import('../src/common/utils/hash-token');
    const raw = 'stale-raw-token';
    row.token = hashToken(raw);

    let caught: unknown;
    try {
      await auth.refreshTokens(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);

    // No reuse-detection side effects.
    expect(auditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.TOKEN_REUSE_DETECTED })
    );
    expect(recordAuthEvent).not.toHaveBeenCalledWith('token_reuse_detected');
    expect(store.userRevokedAt.has('user-1')).toBe(false);
  });
});
