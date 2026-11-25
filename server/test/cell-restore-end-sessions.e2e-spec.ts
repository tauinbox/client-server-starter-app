import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, QueryRunner } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { postgresConfig } from '../src/postgres.config';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { User } from '../src/modules/users/entities/user.entity';

// The restore of scripts/cell.sh runs this file. Here it runs on copies of the
// two tables in a schema of its own: on the shared tables its delete would end
// the sessions of the specs that run beside this one.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const SQL = readFileSync(
  join(__dirname, '..', '..', 'scripts', 'restore-end-sessions.sql'),
  'utf8'
);

runWithInfra('The restore ends the sessions of the dump (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let admin: DataSource | undefined;
  let runner: QueryRunner;
  const schema = `restore_probe_${randomUUID().replaceAll('-', '')}`;
  const stamp = Date.now();
  const emails = {
    reset: `restore-reset-${stamp}@example.com`,
    pending: `restore-pending-${stamp}@example.com`,
    plain: `restore-plain-${stamp}@example.com`
  };
  const ids: Record<keyof typeof emails, string> = {
    reset: '',
    pending: '',
    plain: ''
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    dataSource = app.get(DataSource);

    const users = dataSource.getRepository(User);
    const inAnHour = new Date(Date.now() + 3_600_000);
    const seed = async (
      email: string,
      fields: Partial<User>
    ): Promise<string> =>
      (
        await users.save(
          users.create({
            email,
            name: 'Restore Probe',
            isEmailVerified: true,
            password: null,
            ...fields
          })
        )
      ).id;

    ids.reset = await seed(emails.reset, {
      passwordResetToken: 'reset-hash',
      passwordResetExpiresAt: inAnHour
    });
    ids.pending = await seed(emails.pending, {
      pendingEmail: `restore-new-${stamp}@example.com`,
      pendingEmailToken: 'pending-hash',
      pendingEmailExpiresAt: inAnHour
    });
    ids.plain = await seed(emails.plain, {});

    const refreshTokens = app.get(RefreshTokenService);

    for (let i = 0; i < 2; i++) {
      await refreshTokens.createRefreshToken(ids.reset, {
        token: `raw-${randomUUID()}`,
        sessionId: randomUUID(),
        client: { userAgent: null, ipAddress: null }
      });
    }

    // The restore runs as the administrator of the database, as here.
    admin = new DataSource({
      ...postgresConfig(),
      entities: [],
      migrations: [],
      logging: false
    });
    await admin.initialize();
    runner = admin.createQueryRunner();
    await runner.connect();
    await runner.query(`create schema "${schema}"`);
    await runner.query(
      `create table "${schema}".users (like public.users including defaults)`
    );
    await runner.query(
      `create table "${schema}".refresh_tokens (like public.refresh_tokens including defaults)`
    );
    await runner.query(
      `insert into "${schema}".users select * from public.users where id = any($1)`,
      [Object.values(ids)]
    );
    await runner.query(
      `insert into "${schema}".refresh_tokens select * from public.refresh_tokens where user_id = $1`,
      [ids.reset]
    );
    await runner.query(`set search_path to "${schema}"`);
  }, 60000);

  afterAll(async () => {
    if (runner) {
      await runner.query(`drop schema if exists "${schema}" cascade`);
      await runner.release();
    }

    await admin?.destroy();

    await dataSource
      ?.getRepository(User)
      .delete(Object.values(ids).filter(Boolean));
    await app?.close();
  });

  it('deletes every session and clears each pending link in one statement', async () => {
    const [{ summary }] = (await runner.query(SQL)) as [{ summary: string }];

    expect(summary).toBe(
      '  2 refresh tokens deleted, 2 users lost a pending link'
    );

    const [{ sessions }] = (await runner.query(
      'select count(*)::int as sessions from refresh_tokens'
    )) as [{ sessions: number }];

    expect(sessions).toBe(0);

    const rows = (await runner.query(
      `select email, password_reset_token, password_reset_expires_at, pending_email,
         pending_email_token, pending_email_expires_at
       from users order by email`
    )) as Record<string, string | null>[];

    expect(rows).toEqual(
      [emails.pending, emails.plain, emails.reset].map((email) => ({
        email,
        password_reset_token: null,
        password_reset_expires_at: null,
        pending_email: null,
        pending_email_token: null,
        pending_email_expires_at: null
      }))
    );

    // The shared tables keep their rows: the statement ran on the copies only.
    expect(
      await dataSource
        .getRepository(RefreshToken)
        .count({ where: { userId: ids.reset } })
    ).toBe(2);
  }, 30000);
});
