import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { User } from '../src/modules/users/entities/user.entity';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { hashToken } from '../src/common/utils/hash-token';
import { withPrivateThrottlerStorage } from './private-throttler';

// New recovery codes carry three groups. Enrolments made before the entropy
// rise hold two-group codes, and nothing forces those owners to replace them,
// so the DTO and the stored digest path must accept both forms.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('POST /auth/mfa/recovery code format (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let mfaService: MfaService;
  const email = `mfa-recovery-format-${Date.now()}@example.com`;
  const password = 'Granite-Harbour-83';
  const currentCode = 'ABCDEFGH-IJKLMNOP-QRSTUVWX';
  const legacyCode = 'ABCDEFGH-IJKLMNOP';

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
    mfaService = app.get(MfaService);

    await request(http())
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'Mfa', lastName: 'Recovery' })
      .expect(201);

    // The recovery route never reads the secret, so a stored enrolment is enough.
    await dataSource.getRepository(User).update(
      { email },
      {
        isEmailVerified: true,
        totpSecret: 'v1.not.a.real.secret',
        totpEnabledAt: new Date(),
        totpRecoveryCodes: [
          hashToken(currentCode.replaceAll('-', '')),
          hashToken(legacyCode.replaceAll('-', ''))
        ]
      }
    );
  }, 60000);

  afterAll(async () => {
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  // Minted directly: the login route allows fewer requests a minute than a
  // suite that signs in more than once needs.
  async function pendingToken(): Promise<string> {
    const user = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { email } });
    return mfaService.issuePendingToken(user).mfaToken;
  }

  async function recover(recoveryCode: string) {
    return request(http())
      .post('/api/v1/auth/mfa/recovery')
      .send({ mfaToken: await pendingToken(), recoveryCode });
  }

  it('signs in with a three-group code', async () => {
    const res = await recover(currentCode.toLowerCase());
    expect(res.status).toBe(200);
  }, 30000);

  it('signs in with a legacy two-group code', async () => {
    const res = await recover(legacyCode);
    expect(res.status).toBe(200);

    const stored = await dataSource
      .getRepository(User)
      .findOneOrFail({ where: { email } });
    expect(stored.totpRecoveryCodes).toEqual([]);
  }, 30000);

  it('rejects a third group of the wrong length before it reaches the service', async () => {
    const res = await recover('ABCDEFGH-IJKLMNOP-QRST');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(
      'recoveryCode must match /^[A-Za-z2-7]{8}-?[A-Za-z2-7]{8}(?:-?[A-Za-z2-7]{8})?$/ regular expression'
    );
  }, 30000);
});
