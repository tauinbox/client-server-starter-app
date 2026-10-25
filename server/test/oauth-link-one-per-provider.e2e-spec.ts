// The API addresses a linked provider by name only, so an account holds one
// identity per provider. Only the unique (user_id, provider) index makes that
// hold under concurrent links, so the proof runs against the real table.

import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { postgresConfig } from '../src/postgres.config';
import { OAuthService } from '../src/modules/auth/services/oauth.service';
import { OAuthAccountService } from '../src/modules/auth/services/oauth-account.service';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MailService } from '../src/modules/mail/mail.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { OAuthAccount } from '../src/modules/auth/entities/oauth-account.entity';
import { User } from '../src/modules/users/entities/user.entity';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('One linked identity per provider (e2e)', () => {
  let ds: DataSource;
  let module: TestingModule;
  let service: OAuthService;
  let accounts: OAuthAccountService;
  let userId: string;
  let stamp: string;

  // Seconds, as a JWT `iat` is; the seeded user has no revocation.
  const LINK_TOKEN_IAT = Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    ds = new DataSource({ ...postgresConfig(), logging: false });
    await ds.initialize();

    module = await Test.createTestingModule({
      providers: [
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
            findOne: (id: string) =>
              ds.getRepository(User).findOneByOrFail({ id })
          }
        },
        {
          provide: AuditService,
          useValue: { logFireAndForget: () => undefined }
        },
        {
          provide: MailService,
          useValue: { sendOAuthLinkedNotification: () => Promise.resolve() }
        },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: MfaService, useValue: {} },
        { provide: RoleService, useValue: {} },
        { provide: MetricsService, useValue: {} }
      ]
    }).compile();

    service = module.get(OAuthService);
    accounts = module.get(OAuthAccountService);
  }, 30000);

  beforeEach(async () => {
    stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [{ id }] = await ds.query<Array<{ id: string }>>(
      `INSERT INTO users (email, "name", password)
       VALUES ($1, 'Link Twice', 'hashed') RETURNING id`,
      [`oauth-one-per-provider-${stamp}@example.com`]
    );
    userId = id;
  });

  afterEach(async () => {
    // oauth_accounts.user_id cascades on delete.
    await ds.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });

  afterAll(async () => {
    await module?.close();
    await ds?.destroy();
  });

  const link = (id: string, providerId: string): Promise<void> =>
    service.linkOAuthToUser(id, 'google', providerId, LINK_TOKEN_IAT);

  it('refuses a second identity of a linked provider, and the unlink removes one row', async () => {
    const id = userId;
    await link(id, `google-a-${stamp}`);

    await expect(link(id, `google-b-${stamp}`)).rejects.toMatchObject({
      status: 409,
      response: { errorKey: ErrorKeys.AUTH.OAUTH_PROVIDER_ALREADY_LINKED }
    });

    const linked = await accounts.findByUserId(id);
    expect(linked.map((a) => a.providerId)).toEqual([`google-a-${stamp}`]);

    await accounts.unlinkProvider(id, 'google');
    expect(await accounts.findByUserId(id)).toHaveLength(0);
  }, 30000);

  it('keeps a repeated link of the same identity a no-op', async () => {
    const id = userId;
    await link(id, `google-a-${stamp}`);

    await expect(link(id, `google-a-${stamp}`)).resolves.toBeUndefined();
    expect(await accounts.findByUserId(id)).toHaveLength(1);
  }, 30000);

  it('lets one of two concurrent links of different identities win', async () => {
    const id = userId;
    const runners = [ds.createQueryRunner(), ds.createQueryRunner()];
    await Promise.all(runners.map((r) => r.connect()));
    await Promise.all(runners.map((r) => r.release()));

    const outcomes = await Promise.allSettled([
      link(id, `google-a-${stamp}`),
      link(id, `google-b-${stamp}`)
    ]);

    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      status: 409,
      response: { errorKey: ErrorKeys.AUTH.OAUTH_PROVIDER_ALREADY_LINKED }
    });
    expect(await accounts.findByUserId(id)).toHaveLength(1);
  }, 30000);
});
