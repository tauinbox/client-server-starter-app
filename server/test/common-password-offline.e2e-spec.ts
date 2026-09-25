import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Server } from 'http';
import { DataSource, In } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import { User } from '../src/modules/users/entities/user.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// The range lookup fails open, so during an outage it refuses nothing. This
// suite points it at a closed port and proves that the local list still
// refuses a common password, while a clean one is still accepted.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Common password check without the range lookup (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const previousRangeUrl = process.env['PWNED_PASSWORDS_RANGE_URL'];
  const stamp = Date.now();
  const commonEmail = `common-pw-${stamp}@example.com`;
  const cleanEmail = `clean-pw-${stamp}@example.com`;

  beforeAll(async () => {
    // Port 1 on loopback has no listener, so every lookup is refused at once.
    process.env['PWNED_PASSWORDS_RANGE_URL'] = 'http://127.0.0.1:1/range';

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
  }, 60000);

  afterAll(async () => {
    if (previousRangeUrl === undefined) {
      delete process.env['PWNED_PASSWORDS_RANGE_URL'];
    } else {
      process.env['PWNED_PASSWORDS_RANGE_URL'] = previousRangeUrl;
    }
    await dataSource
      ?.getRepository(User)
      .delete({ email: In([commonEmail, cleanEmail]) });
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  it('refuses a listed password and creates no account', async () => {
    const response = await request(http())
      .post('/api/v1/auth/register')
      .send({
        email: commonEmail,
        password: 'Password123',
        firstName: 'Common',
        lastName: 'Check'
      })
      .expect(400);

    expect((response.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.PASSWORD_TOO_COMMON
    );
    expect(
      await dataSource.getRepository(User).countBy({ email: commonEmail })
    ).toBe(0);
  }, 30000);

  it('still accepts a clean password while the lookup is down', async () => {
    await request(http())
      .post('/api/v1/auth/register')
      .send({
        email: cleanEmail,
        password: 'Sunrise-Kettle-19',
        firstName: 'Clean',
        lastName: 'Check'
      })
      .expect(201);
  }, 30000);
});
