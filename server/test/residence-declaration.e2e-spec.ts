import { INestApplication, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import { CoreModule } from '../src/modules/core/core.module';
import { User } from '../src/modules/users/entities/user.entity';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// The write is keyed on the empty column, so only a real database shows that
// of two declarations that wait on the same row one wins and one is refused.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Residence declaration (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let http: Server;
  const email = `residence-declaration-${Date.now()}@example.com`;
  const password = 'Sunrise-Kettle-19';
  let userId: string;
  let bearer: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    ).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ApiValidationPipe());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);
    http = app.getHttpServer() as Server;

    await request(http)
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        name: 'Residence Owner',
        residenceCountry: 'DE'
      })
      .expect(201);

    // An account from before the column: verified, with no country.
    await dataSource
      .getRepository(User)
      .update({ email }, { isEmailVerified: true, residenceCountry: null });

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const body = login.body as {
      tokens: { access_token: string };
      user: { id: string; residenceCountry: string | null };
    };

    expect(body.user.residenceCountry).toBeNull();
    userId = body.user.id;
    bearer = body.tokens.access_token;
  }, 60000);

  afterAll(async () => {
    await dataSource?.getRepository(AuditLog).delete({ targetId: userId });
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  /** Waits until `count` declarations wait on the row lock of the user. */
  async function waitForLockWaiters(count: number): Promise<void> {
    for (let poll = 0; poll < 200; poll++) {
      const [{ waiting }] = await dataSource.query<Array<{ waiting: number }>>(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%residence_country%'`
      );

      if (waiting >= count) return;

      await new Promise((resolve) => setImmediate(resolve));
    }

    throw new Error(`Fewer than ${count} declarations waited on the row lock`);
  }

  const declare = (residenceCountry: string) =>
    request(http)
      .post('/api/v1/auth/profile/residence')
      .auth(bearer, { type: 'bearer' })
      .send({ residenceCountry })
      .then((res) => res);

  it('keeps the first of two concurrent declarations and refuses the second', async () => {
    const holder = dataSource.createQueryRunner();

    await holder.connect();
    await holder.startTransaction();

    let answers: Awaited<ReturnType<typeof declare>>[];

    try {
      await holder.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        userId
      ]);
      const pending = Promise.all([declare('DE'), declare('FR')]);

      await waitForLockWaiters(2);
      await holder.rollbackTransaction();
      answers = await pending;
    } finally {
      await holder.release();
    }

    const statuses = answers.map(({ status }) => status).toSorted();

    expect(statuses).toEqual([200, 409]);

    const won = answers.find(({ status }) => status === 200)!;
    const lost = answers.find(({ status }) => status === 409)!;
    const winner = (won.body as { residenceCountry: string }).residenceCountry;

    expect((lost.body as { errorKey: string }).errorKey).toBe(
      ErrorKeys.AUTH.RESIDENCE_ALREADY_DECLARED
    );

    const stored = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: userId });

    expect(stored.residenceCountry).toBe(winner);

    const rows = await dataSource.getRepository(AuditLog).findBy({
      targetId: userId,
      action: AuditAction.USER_UPDATE
    });

    expect(rows.map(({ details }) => details)).toEqual([
      { changedFields: ['residenceCountry'], source: 'self' }
    ]);

    const profile = await request(http)
      .get('/api/v1/auth/profile')
      .auth(bearer, { type: 'bearer' })
      .expect(200);

    expect(
      (profile.body as { residenceCountry: string }).residenceCountry
    ).toBe(winner);
  }, 30000);
});
