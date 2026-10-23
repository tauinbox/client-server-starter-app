// A write that marks an address verified is keyed on the proof it consumed:
// an administrator email change that lands between the read and the write
// voids that proof, and the write must then miss. Each race is forced by a
// spy that runs the administrator change after the read.

import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as crypto from 'crypto';
import { Server } from 'http';
import { DataSource, In, SelectQueryBuilder } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { UsersService } from '../src/modules/users/services/users.service';
import { OAuthService } from '../src/modules/auth/services/oauth.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { OAuthAccount } from '../src/modules/auth/entities/oauth-account.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { hashToken } from '../src/common/utils/hash-token';
import { withPrivateThrottlerStorage } from './private-throttler';

// Skips without DB_HOST (bare local run); CI provides a migrated Postgres.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('A write that proves mailbox ownership (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let usersService: UsersService;
  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const createdIds: string[] = [];
  let counter = 0;

  beforeAll(async () => {
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    ).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);
    usersService = app.get(UsersService);
  }, 60000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (createdIds.length) {
      await dataSource
        .getRepository(AuditLog)
        .delete({ targetId: In(createdIds) });
      // oauth_accounts.user_id cascades on delete.
      await dataSource.getRepository(User).delete({ id: In(createdIds) });
    }
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  function nextEmail(label: string): string {
    counter += 1;
    return `proof-${label}-${counter}-${stamp}@example.com`;
  }

  async function createUser(fields: Partial<User>): Promise<User> {
    const repo = dataSource.getRepository(User);
    const user = await repo.save(
      repo.create({
        email: nextEmail('owner'),
        firstName: 'Proof',
        lastName: 'Owner',
        password: null,
        isEmailVerified: false,
        ...fields
      })
    );
    createdIds.push(user.id);
    return user;
  }

  function reload(id: string): Promise<User> {
    return dataSource.getRepository(User).findOneByOrFail({ id });
  }

  function adminChangesEmail(id: string, email: string): Promise<User> {
    return usersService.update(id, { email }, SYSTEM_ABILITY);
  }

  async function userWithVerificationToken(
    fields: Partial<User> = {}
  ): Promise<{ user: User; rawToken: string }> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const user = await createUser({
      emailVerificationToken: hashToken(rawToken),
      emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...fields
    });
    return { user, rawToken };
  }

  it('refuses the verification link of a deactivated account like an unknown token', async () => {
    const { user, rawToken } = await userWithVerificationToken({
      isActive: false
    });

    const res = await request(http())
      .post('/api/v1/auth/verify-email')
      .send({ token: rawToken })
      .expect(400);

    expect(res.body).toMatchObject({
      message: 'Invalid or expired verification token',
      errorKey: ErrorKeys.AUTH.INVALID_VERIFICATION_TOKEN
    });
    expect((await reload(user.id)).isEmailVerified).toBe(false);
  }, 30000);

  it('a verification link that races an administrator email change leaves the new address unverified', async () => {
    const { user, rawToken } = await userWithVerificationToken();
    const adminEmail = nextEmail('admin');
    const original =
      usersService.findByEmailVerificationToken.bind(usersService);
    jest
      .spyOn(usersService, 'findByEmailVerificationToken')
      .mockImplementationOnce(async (hashed) => {
        const read = await original(hashed);
        await adminChangesEmail(user.id, adminEmail);
        return read;
      });

    const res = await request(http())
      .post('/api/v1/auth/verify-email')
      .send({ token: rawToken })
      .expect(400);

    expect(res.body).toMatchObject({
      errorKey: ErrorKeys.AUTH.INVALID_VERIFICATION_TOKEN
    });
    const after = await reload(user.id);
    expect(after.email).toBe(adminEmail);
    expect(after.isEmailVerified).toBe(false);
    // The link mailed to the new address is still the one that verifies it.
    expect(after.emailVerificationToken).not.toBeNull();
    expect(after.emailVerificationToken).not.toBe(hashToken(rawToken));
  }, 30000);

  it('an email-change confirmation that races an administrator change keeps the address the administrator set', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const user = await createUser({
      isEmailVerified: true,
      pendingEmail: nextEmail('pending'),
      pendingEmailToken: hashToken(rawToken),
      pendingEmailExpiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    const adminEmail = nextEmail('admin');
    let injected = false;
    const original: (this: SelectQueryBuilder<User>) => Promise<User | null> =
      SelectQueryBuilder.prototype.getOne;
    jest
      .spyOn(SelectQueryBuilder.prototype, 'getOne')
      .mockImplementation(async function (this: SelectQueryBuilder<User>) {
        // The conflict check of confirmEmailChange runs between its read of
        // the row and its write.
        if (!injected && this.alias === 'u') {
          injected = true;
          await adminChangesEmail(user.id, adminEmail);
        }
        return original.call(this);
      });

    const res = await request(http())
      .post('/api/v1/auth/profile/email/confirm')
      .send({ token: rawToken })
      .expect(400);

    expect(injected).toBe(true);
    expect(res.body).toMatchObject({
      errorKey: ErrorKeys.AUTH.PENDING_EMAIL_TOKEN_EXPIRED
    });
    const after = await reload(user.id);
    expect(after.email).toBe(adminEmail);
    expect(after.isEmailVerified).toBe(false);
  }, 30000);

  it('a provider sign-in that races an administrator email change leaves the new address unverified', async () => {
    const user = await createUser({});
    const providerId = `google-proof-${stamp}`;
    await dataSource
      .getRepository(OAuthAccount)
      .save({ userId: user.id, provider: 'google', providerId });
    const adminEmail = nextEmail('admin');
    const original = usersService.findOne.bind(usersService);
    jest
      .spyOn(usersService, 'findOne')
      .mockImplementationOnce(async (id, ability) => {
        const read = await original(id, ability);
        await adminChangesEmail(user.id, adminEmail);
        return read;
      });

    await app.get(OAuthService).loginWithOAuth({
      provider: 'google',
      providerId,
      email: user.email,
      firstName: 'Proof',
      lastName: 'Owner',
      emailVerified: true
    });

    const after = await reload(user.id);
    expect(after.email).toBe(adminEmail);
    expect(after.isEmailVerified).toBe(false);
  }, 30000);
});
