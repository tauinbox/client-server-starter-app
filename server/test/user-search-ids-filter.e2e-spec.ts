import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { Server } from 'http';
import { DataSource, In } from 'typeorm';
import { MAX_PAGE_SIZE } from '@app/shared/constants';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { RoleService } from '../src/modules/auth/services/role.service';
import { withPrivateThrottlerStorage } from './private-throttler';

// The feature-flag rule editor labels a user rule with one request per 100
// ids through this filter, instead of one GET /users/:id per id, which
// spent the 120-a-minute budget of the admin on one rule.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('GET /users/search/cursor?ids= (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  const stamp = Date.now();
  const adminEmail = `ids-filter-admin-${stamp}@example.com`;
  const emails = [1, 2, 3].map((n) => `ids-filter-${n}-${stamp}@example.com`);
  const ids: string[] = [];
  const password = 'Lantern-Orchard-47';

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
    const users = dataSource.getRepository(User);

    for (const email of [adminEmail, ...emails]) {
      await request(http())
        .post('/api/v1/auth/register')
        .send({ email, password, firstName: 'Ids', lastName: 'Filter' })
        .expect(201);
    }
    for (const email of emails) {
      ids.push((await users.findOneByOrFail({ email })).id);
    }

    const superRole = await dataSource
      .getRepository(Role)
      .findOneByOrFail({ isSuper: true });
    const admin = await users.findOneByOrFail({ email: adminEmail });
    await app.get(RoleService).assignRoleToUser(admin.id, superRole.id);

    await users.softDelete({ id: ids[2] });

    const { tokens } = await app
      .get(AuthService)
      .login(await app.get(UsersService).findOne(admin.id), {
        userAgent: 'ids-filter-e2e',
        ipAddress: null
      });
    token = tokens.access_token;
  }, 60000);

  afterAll(async () => {
    await dataSource
      ?.getRepository(User)
      .delete({ email: In([adminEmail, ...emails]) });
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  function search(query: string) {
    return request(http())
      .get(`/api/v1/users/search/cursor?limit=${MAX_PAGE_SIZE}&${query}`)
      .auth(token, { type: 'bearer' });
  }

  function returnedIds(body: unknown): string[] {
    return (body as { data: Array<{ id: string }> }).data
      .map((user) => user.id)
      .sort();
  }

  it('returns exactly the listed users', async () => {
    const res = await search(`ids=${ids[0]},${ids[1]}`).expect(200);

    expect(returnedIds(res.body)).toEqual([ids[0], ids[1]].sort());
  });

  it('leaves out a soft-deleted user unless includeDeleted is set', async () => {
    const list = ids.join(',');

    const live = await search(`ids=${list}`).expect(200);
    const all = await search(`ids=${list}&includeDeleted=true`).expect(200);

    expect(returnedIds(live.body)).toEqual([ids[0], ids[1]].sort());
    expect(returnedIds(all.body)).toEqual([...ids].sort());
  });

  it(`answers 400 for ${MAX_PAGE_SIZE + 1} ids`, async () => {
    const tooMany = Array.from(
      { length: MAX_PAGE_SIZE + 1 },
      () => ids[0]
    ).join(',');

    const res = await search(`ids=${tooMany}`).expect(400);

    expect((res.body as { message: string }).message).toBe(
      `ids must contain no more than ${MAX_PAGE_SIZE} elements`
    );
  });

  it('answers 400 for a value that is not a UUID', async () => {
    const res = await search(`ids=${ids[0]},nope`).expect(400);

    expect((res.body as { message: string }).message).toBe(
      'each value in ids must be a UUID'
    );
  });
});
