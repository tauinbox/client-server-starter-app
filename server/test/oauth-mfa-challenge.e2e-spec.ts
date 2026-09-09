// A provider sign-in on an enrolled account must answer with a challenge and
// leave NO refresh row behind. A unit test on OAuthService cannot show that:
// the row is written by SessionIssuerService through the real repository, so
// only a run against the real table proves the session was never created.

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { postgresConfig } from '../src/postgres.config';
import { createMockConfigService } from '../src/common/testing/config-service.mock';
import { OAuthService } from '../src/modules/auth/services/oauth.service';
import { OAuthAccountService } from '../src/modules/auth/services/oauth-account.service';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { SessionIssuerService } from '../src/modules/auth/services/session-issuer.service';
import { SessionLimitService } from '../src/modules/auth/services/session-limit.service';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import { TokenGeneratorService } from '../src/modules/auth/services/token-generator.service';
import { EntitlementService } from '../src/modules/entitlements/entitlement.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MailService } from '../src/modules/mail/mail.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { OAuthAccount } from '../src/modules/auth/entities/oauth-account.entity';
import { User } from '../src/modules/users/entities/user.entity';
import type { OAuthUserProfile } from '../src/modules/auth/types/oauth-profile';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Provider sign-in with a second factor (e2e)', () => {
  let ds: DataSource;
  let module: TestingModule;
  let service: OAuthService;
  let userId: string | undefined;
  let providerId: string;

  const profile = (): OAuthUserProfile => ({
    provider: 'google',
    providerId,
    email: `oauth-mfa-${providerId}@example.com`,
    firstName: 'Oauth',
    lastName: 'Factor',
    emailVerified: true
  });

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();

    module = await Test.createTestingModule({
      providers: [
        // Everything on the session write path is the real thing; only the
        // collaborators the already-linked branch never reaches are stubbed.
        OAuthService,
        OAuthAccountService,
        SessionIssuerService,
        SessionLimitService,
        RefreshTokenService,
        TokenGeneratorService,
        { provide: DataSource, useValue: ds },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: ds.getRepository(RefreshToken)
        },
        {
          provide: getRepositoryToken(OAuthAccount),
          useValue: ds.getRepository(OAuthAccount)
        },
        {
          provide: ConfigService,
          useValue: createMockConfigService({
            JWT_REFRESH_EXPIRATION: '604800',
            JWT_EXPIRATION: '3600'
          })
        },
        { provide: JwtService, useValue: new JwtService({ secret: 'e2e' }) },
        {
          provide: UsersService,
          // The response carries RoleResponse[], so the entity arrives with
          // `roles` hydrated exactly as the real service returns it.
          useValue: {
            findOne: (id: string) =>
              ds
                .getRepository(User)
                .findOneOrFail({ where: { id }, relations: ['roles'] })
          }
        },
        {
          provide: MfaService,
          useValue: {
            issuePendingToken: () => ({
              mfaToken: 'pending-token',
              expiresIn: 300
            })
          }
        },
        { provide: EntitlementService, useValue: { limitFor: () => null } },
        { provide: RoleService, useValue: {} },
        { provide: AuditService, useValue: { log: () => undefined } },
        { provide: MailService, useValue: {} }
      ]
    }).compile();

    service = module.get(OAuthService);
  }, 30000);

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    providerId = `google-${stamp}`;
    const [{ id }] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO users (email, "firstName", "lastName", password, is_email_verified)
       VALUES ($1, 'Oauth', 'Factor', NULL, true) RETURNING id`,
      [`oauth-mfa-${stamp}@example.com`]
    );
    userId = id;
    await ds.query(
      `INSERT INTO oauth_accounts (provider, provider_id, user_id)
       VALUES ('google', $1, $2)`,
      [providerId, id]
    );
  });

  afterEach(async () => {
    if (userId) {
      // refresh_tokens.user_id and oauth_accounts.user_id cascade on delete.
      await ds.query(`DELETE FROM users WHERE id = $1`, [userId]);
      userId = undefined;
    }
  });

  afterAll(async () => {
    await module?.close();
    await ds?.destroy();
  });

  const refreshRowCount = async (): Promise<number> => {
    const [{ count }] = await ds.query<Array<{ count: number }>>(
      `SELECT count(*)::int AS count FROM refresh_tokens WHERE user_id = $1`,
      [userId]
    );
    return count;
  };

  it('answers with a challenge and writes no refresh row for an enrolled account', async () => {
    await ds.query(`UPDATE users SET totp_enabled_at = now() WHERE id = $1`, [
      userId
    ]);

    const result = await service.loginWithOAuth(profile());

    expect(result).toEqual({
      mfaRequired: true,
      mfaToken: 'pending-token',
      expiresIn: 300
    });
    expect(await refreshRowCount()).toBe(0);
  }, 30000);

  it('still issues a session, and its refresh row, for an account with no factor', async () => {
    const result = await service.loginWithOAuth(profile());

    expect('mfaRequired' in result).toBe(false);
    expect(await refreshRowCount()).toBe(1);
  }, 30000);
});
