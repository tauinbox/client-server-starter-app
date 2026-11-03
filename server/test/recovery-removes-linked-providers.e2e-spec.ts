// A provider linked while someone else held the password is a sign-in
// credential of that holder. Account recovery must remove it, and a link
// callback that runs at the same time must not survive the recovery. The
// proof needs the real tables and the real row locks.

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorKeys, OAUTH_ERROR } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { postgresConfig } from '../src/postgres.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { OAuthService } from '../src/modules/auth/services/oauth.service';
import { OAuthAccountService } from '../src/modules/auth/services/oauth-account.service';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { TokenGeneratorService } from '../src/modules/auth/services/token-generator.service';
import { SessionIssuerService } from '../src/modules/auth/services/session-issuer.service';
import { PurposeTokenService } from '../src/modules/auth/services/purpose-token.service';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { BreachedPasswordService } from '../src/modules/auth/breached-password/breached-password.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MailService } from '../src/modules/mail/mail.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { OAuthAccount } from '../src/modules/auth/entities/oauth-account.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { createMockCache } from '../src/common/testing/cache.mock';
import { hashToken } from '../src/common/utils/hash-token';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Account recovery removes the linked providers (e2e)', () => {
  let ds: DataSource;
  let module: TestingModule;
  let auth: AuthService;
  let oauth: OAuthService;
  let accounts: OAuthAccountService;
  const audit = { logFireAndForget: jest.fn() };
  let userId: string;
  let email: string;
  let stamp: string;

  // Seconds, as a JWT `iat` is: the intent was proved a minute ago.
  const linkTokenIssuedAt = (): number => Math.floor(Date.now() / 1000) - 60;

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();

    const users = ds.getRepository(User);
    module = await Test.createTestingModule({
      providers: [
        AuthService,
        OAuthService,
        OAuthAccountService,
        { provide: DataSource, useValue: ds },
        {
          provide: getRepositoryToken(OAuthAccount),
          useValue: ds.getRepository(OAuthAccount)
        },
        {
          provide: UsersService,
          useValue: {
            findOne: (id: string) => users.findOneByOrFail({ id }),
            findByPasswordResetToken: (hash: string) =>
              users.findOneBy({ passwordResetToken: hash })
          }
        },
        { provide: AuditService, useValue: audit },
        {
          provide: MailService,
          useValue: {
            sendPasswordChangedNotification: () => Promise.resolve(),
            sendOAuthLinkedNotification: () => Promise.resolve(),
            sendOAuthUnlinkedNotification: () => Promise.resolve()
          }
        },
        {
          provide: BreachedPasswordService,
          useValue: { assertNotBreached: () => Promise.resolve() }
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: CACHE_MANAGER, useValue: createMockCache() },
        { provide: ConfigService, useValue: {} },
        { provide: RefreshTokenService, useValue: {} },
        { provide: RoleService, useValue: {} },
        { provide: TokenGeneratorService, useValue: {} },
        { provide: SessionIssuerService, useValue: {} },
        { provide: PurposeTokenService, useValue: {} },
        { provide: MfaService, useValue: {} },
        { provide: MetricsService, useValue: {} }
      ]
    }).compile();

    auth = module.get(AuthService);
    oauth = module.get(OAuthService);
    accounts = module.get(OAuthAccountService);
  }, 30000);

  beforeEach(async () => {
    audit.logFireAndForget.mockClear();
    stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    email = `recovery-unlink-${stamp}@example.com`;
    const saved = await ds.getRepository(User).save({
      email,
      name: 'Recovered Owner',
      password: 'hashed',
      passwordResetToken: hashToken(`reset-${stamp}`),
      passwordResetExpiresAt: new Date(Date.now() + 3600000)
    });
    userId = saved.id;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    // oauth_accounts.user_id cascades on delete.
    await ds.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  afterAll(async () => {
    await module?.close();
    await ds?.destroy();
  });

  const link = (providerId: string): Promise<void> =>
    oauth.linkOAuthToUser(
      userId,
      { provider: 'google', providerId },
      { linkTokenIssuedAt: linkTokenIssuedAt() }
    );

  const reset = (): Promise<{ message: string }> =>
    auth.resetPassword(`reset-${stamp}`, `Recovered-${stamp}`);

  const unlinkRows = (): unknown[] =>
    audit.logFireAndForget.mock.calls
      .map(([row]: [{ action: AuditAction }]) => row)
      .filter((row) => row.action === AuditAction.OAUTH_UNLINK);

  it('a password reset removes the provider, so it no longer signs in as the owner', async () => {
    const providerId = `google-intruder-${stamp}`;
    await link(providerId);

    await reset();

    expect(await accounts.findByUserId(userId)).toHaveLength(0);
    expect(unlinkRows()).toEqual([
      expect.objectContaining({
        actorId: userId,
        targetId: userId,
        details: { provider: 'google', source: 'password_reset' }
      })
    ]);
    // The provider identity now names no account: with the owner's address
    // it is refused instead of signing the owner in.
    await expect(
      oauth.loginWithOAuth({
        provider: 'google',
        providerId,
        email,
        name: 'Intruder',
        emailVerified: true
      })
    ).rejects.toMatchObject({
      oauthError: OAUTH_ERROR.EMAIL_ALREADY_REGISTERED
    });
  }, 30000);

  it('an administrator recovery removes the provider', async () => {
    await link(`google-intruder-${stamp}`);

    await auth.removeLinkedProviders(
      { id: userId, email, locale: 'en' },
      {
        source: 'admin',
        actor: { actorId: 'admin-id', actorEmail: 'admin@example.com' }
      }
    );

    expect(await accounts.findByUserId(userId)).toHaveLength(0);
    expect(unlinkRows()).toEqual([
      expect.objectContaining({
        actorId: 'admin-id',
        details: { provider: 'google', source: 'admin' }
      })
    ]);
  }, 30000);

  it('a profile password change that asks for it removes the provider', async () => {
    await link(`google-intruder-${stamp}`);
    expect(await auth.linkedProviders(userId)).toEqual(['google']);

    await auth.removeLinkedProviders(
      { id: userId, email, locale: 'en' },
      { source: 'self', actor: { actorId: userId, actorEmail: email } }
    );

    expect(await auth.linkedProviders(userId)).toEqual([]);
    expect(unlinkRows()).toEqual([
      expect.objectContaining({
        actorId: userId,
        details: { provider: 'google', source: 'self' }
      })
    ]);
  }, 30000);

  it('a link callback held before its insert makes the reset wait, and the reset removes its row', async () => {
    const { promise: insertGate, resolve: releaseInsert } =
      Promise.withResolvers<void>();
    const { promise: reachedInsert, resolve: insertReached } =
      Promise.withResolvers<void>();
    const original = EntityManager.prototype.insert;
    jest
      .spyOn(EntityManager.prototype, 'insert')
      .mockImplementation(async function (
        this: EntityManager,
        ...args: Parameters<EntityManager['insert']>
      ) {
        if (args[0] === OAuthAccount) {
          insertReached();
          await insertGate;
        }
        return original.apply(this, args);
      });

    const linking = link(`google-racer-${stamp}`);
    await reachedInsert;

    let resetDone = false;
    const resetting = reset().then((result) => {
      resetDone = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    // The link holds the user row, so the reset cannot write it yet.
    expect(resetDone).toBe(false);

    releaseInsert();
    await expect(linking).resolves.toBeUndefined();
    await resetting;

    expect(await accounts.findByUserId(userId)).toHaveLength(0);
  }, 30000);

  it('a link callback after the reset is refused', async () => {
    await reset();

    await expect(link(`google-late-${stamp}`)).rejects.toMatchObject({
      response: { errorKey: ErrorKeys.AUTH.TOKEN_REVOKED }
    });
    expect(await accounts.findByUserId(userId)).toHaveLength(0);
  }, 30000);
});
