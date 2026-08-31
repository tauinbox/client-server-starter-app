// Real AuthService + RefreshTokenService + SessionLimitService +
// EntitlementService over in-memory repositories, so plan row -> resolver ->
// cache -> limit -> oldest-first pruning runs as one chain. A unit test at
// either end cannot see whether the plan limit actually reaches the prune.

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MAX_CONCURRENT_SESSIONS } from '@app/shared/constants';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import { SessionIssuerService } from '../src/modules/auth/services/session-issuer.service';
import { SessionLimitService } from '../src/modules/auth/services/session-limit.service';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { EntitlementService } from '../src/modules/entitlements/entitlement.service';
import { Customer } from '../src/modules/billing/entities/customer.entity';
import { CustomerGrant } from '../src/modules/billing/entities/customer-grant.entity';
import { Plan } from '../src/modules/billing/entities/plan.entity';
import { Subscription } from '../src/modules/billing/entities/subscription.entity';
import { UsersService } from '../src/modules/users/services/users.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { TokenGeneratorService } from '../src/modules/auth/services/token-generator.service';
import { MailService } from '../src/modules/mail/mail.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { User } from '../src/modules/users/entities/user.entity';

const USER_ID = 'user-1';

/**
 * Implements the filtered count and the oldest-first bounded delete for real —
 * stubbing either one out would leave the suite unable to observe the bug it
 * exists to catch.
 */
function makeRefreshTokenRepoMock(store: Map<string, RefreshToken>): {
  repo: Repository<RefreshToken>;
  excessSeen: number[];
} {
  let idSeq = 0;
  let clock = 0;
  const excessSeen: number[] = [];

  function activeTokensOf(userId: string): RefreshToken[] {
    return [...store.values()]
      .filter((t) => t.userId === userId && !t.revoked)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  const repo = {
    create: (data: Partial<RefreshToken>) => {
      const token = new RefreshToken();
      Object.assign(token, data);
      return token;
    },
    save: jest.fn((entity: RefreshToken) => {
      if (!entity.id) entity.id = `rt-${++idSeq}`;
      // Monotonic created_at: a same-millisecond tie would make oldest-first
      // ordering arbitrary and the eviction assertions meaningless.
      if (!entity.createdAt) entity.createdAt = new Date(++clock);
      if (entity.revoked === undefined) entity.revoked = false;
      store.set(entity.id, entity);
      return Promise.resolve(entity);
    }),
    count: jest.fn((opts: { where: { userId: string } }) =>
      Promise.resolve(activeTokensOf(opts.where.userId).length)
    ),
    createQueryBuilder: jest.fn(() => ({
      delete: () => ({
        from: () => ({
          where: (
            _sql: string,
            params: { userId: string; excess: number }
          ) => ({
            execute: () => {
              excessSeen.push(params.excess);
              const doomed = activeTokensOf(params.userId).slice(
                0,
                params.excess
              );
              for (const token of doomed) store.delete(token.id);
              return Promise.resolve({ affected: doomed.length });
            }
          })
        })
      })
    }))
  };
  // @ts-expect-error - partial RefreshToken repository fake: only used methods
  return { repo, excessSeen };
}

describe('Plan-driven concurrent-session allowance (e2e)', () => {
  // @ts-expect-error - partial User fixture: only the fields login reads
  const userRecord: User = {
    id: USER_ID,
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Doe',
    isActive: true,
    isEmailVerified: true,
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
  };

  let auth: AuthService;
  let entitlements: EntitlementService;
  let tokens: Map<string, RefreshToken>;
  let excessSeen: number[];
  let customers: { findOne: jest.Mock };
  let subscriptions: { findOne: jest.Mock };
  let plans: { findOne: jest.Mock };

  function activeTokenCount(): number {
    return [...tokens.values()].filter(
      (t) => t.userId === USER_ID && !t.revoked
    ).length;
  }

  function onPlan(key: string, limits: Plan['limits']): void {
    customers.findOne.mockResolvedValue({ id: 'cust-1', userId: USER_ID });
    subscriptions.findOne.mockResolvedValue({
      id: 'sub-1',
      customerId: 'cust-1',
      planKey: key,
      status: 'active'
    });
    plans.findOne.mockResolvedValue({ key, entitlements: [], limits });
  }

  async function signIn(times: number): Promise<void> {
    for (let i = 0; i < times; i++) await auth.login(userRecord);
  }

  beforeEach(async () => {
    tokens = new Map();
    const rt = makeRefreshTokenRepoMock(tokens);
    excessSeen = rt.excessSeen;

    // No customer row by default — the Free-tier path, which must fall back.
    customers = { findOne: jest.fn().mockResolvedValue(null) };
    subscriptions = { findOne: jest.fn().mockResolvedValue(null) };
    plans = { findOne: jest.fn().mockResolvedValue(null) };

    const cacheStore = new Map<string, unknown>();
    const cache = {
      get: jest.fn((k: string) => Promise.resolve(cacheStore.get(k))),
      set: jest.fn((k: string, v: unknown) => {
        cacheStore.set(k, v);
        return Promise.resolve();
      }),
      del: jest.fn((k: string) => {
        cacheStore.delete(k);
        return Promise.resolve();
      })
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        RefreshTokenService,
        SessionIssuerService,
        SessionLimitService,
        EntitlementService,
        { provide: getRepositoryToken(RefreshToken), useValue: rt.repo },
        { provide: getRepositoryToken(Customer), useValue: customers },
        { provide: getRepositoryToken(Subscription), useValue: subscriptions },
        { provide: getRepositoryToken(Plan), useValue: plans },
        {
          provide: getRepositoryToken(CustomerGrant),
          useValue: { find: jest.fn().mockResolvedValue([]) }
        },
        { provide: CACHE_MANAGER, useValue: cache },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
            getOrThrow: jest.fn((key: string) => {
              if (key === 'JWT_REFRESH_EXPIRATION') return '604800';
              throw new Error(`unexpected config key ${key}`);
            })
          }
        },
        {
          provide: UsersService,
          useValue: { findOne: jest.fn().mockResolvedValue(userRecord) }
        },
        { provide: RoleService, useValue: {} },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), verify: jest.fn() }
        },
        {
          provide: TokenGeneratorService,
          useValue: {
            generateTokens: jest.fn(() => ({
              access_token: `access-${Math.random()}`,
              refresh_token: `refresh-${Math.random()}`,
              expires_in: 3600
            }))
          }
        },
        { provide: MailService, useValue: {} },
        {
          provide: AuditService,
          useValue: { log: jest.fn(), logFireAndForget: jest.fn() }
        },
        {
          provide: MetricsService,
          useValue: {
            recordAuthEvent: jest.fn(),
            recordCacheAccess: jest.fn()
          }
        }
      ]
    }).compile();

    auth = moduleRef.get(AuthService);
    entitlements = moduleRef.get(EntitlementService);
  });

  it('caps a plan without a sessions limit at the built-in constant', async () => {
    await signIn(MAX_CONCURRENT_SESSIONS + 3);

    expect(activeTokenCount()).toBe(MAX_CONCURRENT_SESSIONS);
  });

  it('raises the cap to the plan limit for a paying user', async () => {
    onPlan('pro', { sessions: 10 });

    await signIn(12);

    expect(activeTokenCount()).toBe(10);
  });

  it('never rejects a sign-in past the allowance - it evicts the oldest device', async () => {
    onPlan('pro', { sessions: 10 });
    await signIn(10);
    const oldest = [...tokens.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    )[0];

    const result = await auth.login(userRecord);

    expect(typeof result.tokens.refresh_token).toBe('string');
    expect(activeTokenCount()).toBe(10);
    expect(tokens.has(oldest.id)).toBe(false);
    // Exactly one row per over-limit sign-in, never a bulk purge.
    expect(excessSeen.every((n) => n === 1)).toBe(true);
  });

  it('a downgrade trims at the next sign-in, not at plan-change time', async () => {
    onPlan('business', { sessions: 25 });
    await signIn(12);
    expect(activeTokenCount()).toBe(12);

    onPlan('pro', { sessions: 10 });
    await entitlements.invalidateUser(USER_ID);

    // Deferring the trim to the user's own next sign-in is what keeps a
    // catalog edit from logging an entire tier out at once.
    expect(activeTokenCount()).toBe(12);

    await signIn(1);
    expect(activeTokenCount()).toBe(10);
  });

  it('keeps login working when entitlement resolution fails outright', async () => {
    customers.findOne.mockRejectedValue(new Error('billing database is down'));

    // A billing outage must never become a login outage.
    const result = await auth.login(userRecord);
    expect(typeof result.tokens.access_token).toBe('string');

    await signIn(MAX_CONCURRENT_SESSIONS + 2);
    expect(activeTokenCount()).toBe(MAX_CONCURRENT_SESSIONS);
  });
});
