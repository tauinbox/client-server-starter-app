import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import type { Counter } from 'prom-client';
import request from 'supertest';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { AuditService } from '../src/modules/audit/audit.service';
import { hashToken } from '../src/common/utils/hash-token';
import { withPrivateThrottlerStorage } from './private-throttler';

// A self-service action and its refusals do not depend on the audit row: when
// the row cannot be written, the action keeps its effect and its answer, and
// the loss is counted.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Self-service audit rows: fire-and-forget (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let usersService: UsersService;
  let mfaService: MfaService;
  let failures: Counter<string>;
  const stamp = Date.now();
  const ownerEmail = `self-audit-ff-owner-${stamp}@example.com`;
  const registeredEmail = `self-audit-ff-new-${stamp}@example.com`;
  const password = 'Lantern-Orchard-47';
  const newPassword = 'Copper-Meadow-83';
  let ownerId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    ).compile();

    const expressApp = moduleRef.createNestApplication<NestExpressApplication>(
      HTTP_BODY_APP_OPTIONS
    );
    applyBodyParsers(expressApp);
    app = expressApp;
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
    mfaService = app.get(MfaService);
    failures = app.get(getToken('audit_write_failures_total'));

    ownerId = (
      await usersService.create({
        email: ownerEmail,
        password,
        firstName: 'Self',
        lastName: 'Service'
      })
    ).id;
    await dataSource
      .getRepository(User)
      .update(ownerId, { isEmailVerified: true });
  }, 60000);

  beforeEach(() => {
    jest
      .spyOn(app.get(AuditService), 'log')
      .mockRejectedValue(new Error('audit down'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await dataSource
      ?.getRepository(User)
      .delete([{ email: ownerEmail }, { email: registeredEmail }]);
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  async function lostRows(action: AuditAction): Promise<number> {
    const { values } = await failures.get();
    return values.find((v) => v.labels['action'] === action)?.value ?? 0;
  }

  // The catch of a fire-and-forget write runs after the answer.
  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 50));
  }

  async function owner(): Promise<User> {
    return usersService.findOne(ownerId);
  }

  it('register answers 201, stores the account and counts the lost row', async () => {
    const before = await lostRows(AuditAction.USER_REGISTER);

    await request(http())
      .post('/api/v1/auth/register')
      .send({
        email: registeredEmail,
        password,
        firstName: 'New',
        lastName: 'Account'
      })
      .expect(201);
    await settle();

    expect(
      await dataSource.getRepository(User).countBy({ email: registeredEmail })
    ).toBe(1);
    expect(await lostRows(AuditAction.USER_REGISTER)).toBe(before + 1);
  });

  it('sign-in answers 200 and starts a session', async () => {
    await request(http())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password })
      .expect(200);

    expect(
      await dataSource.getRepository(RefreshToken).countBy({ userId: ownerId })
    ).toBeGreaterThan(0);
  });

  it('a password reset completes', async () => {
    const rawToken = `self-audit-ff-reset-${stamp}`;
    await dataSource.getRepository(User).update(ownerId, {
      passwordResetToken: hashToken(rawToken),
      passwordResetExpiresAt: new Date(Date.now() + 60_000)
    });
    const before = (await owner()).password;

    await expect(
      app.get(AuthService).resetPassword(rawToken, newPassword)
    ).resolves.toBeDefined();

    const after = await owner();
    expect(after.password).not.toBe(before);
    expect(after.passwordResetToken).toBeNull();
  });

  describe('second factor', () => {
    beforeAll(async () => {
      await dataSource
        .getRepository(User)
        .update(ownerId, { totpEnabledAt: new Date() });
    });

    afterAll(async () => {
      await dataSource.getRepository(User).update(ownerId, {
        totpEnabledAt: null,
        totpRecoveryCodes: null
      });
    });

    it('regenerating returns the codes, and a code signs the owner in', async () => {
      const { recoveryCodes } = await mfaService.regenerateRecoveryCodes(
        await owner()
      );
      expect(recoveryCodes).toHaveLength(10);

      const { mfaToken } = mfaService.issuePendingToken(await owner());
      await expect(
        mfaService.consumeRecoveryCode(mfaToken, recoveryCodes[0])
      ).resolves.toMatchObject({ id: ownerId });
    });

    it('a wrong recovery code answers 401, not 500, and counts the lost row', async () => {
      const before = await lostRows(AuditAction.MFA_CHALLENGE_FAILURE);
      const { mfaToken } = mfaService.issuePendingToken(await owner());

      await expect(
        mfaService.consumeRecoveryCode(mfaToken, 'AAAAAAAA-BBBBBBBB')
      ).rejects.toMatchObject({ status: 401 });
      await settle();

      expect(await lostRows(AuditAction.MFA_CHALLENGE_FAILURE)).toBe(
        before + 1
      );
    });
  });
});
