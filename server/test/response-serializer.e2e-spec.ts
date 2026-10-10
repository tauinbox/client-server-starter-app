import {
  Controller,
  Get,
  MessageEvent,
  SerializeOptions,
  Sse,
  VersioningType
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { DataSource } from 'typeorm';
import { Observable, of } from 'rxjs';
import { CoreModule } from '../src/modules/core/core.module';
import { Public } from '../src/modules/auth/decorators/public.decorator';
import { User } from '../src/modules/users/entities/user.entity';

// The controllers carry no serializer of their own: the one that CoreModule
// registers for every route must strip the @Exclude fields and honour the
// @SerializeOptions groups of the controller, on JSON and on SSE alike.
function lockedUser(): User {
  return Object.assign(new User(), {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'serializer@example.com',
    firstName: 'Serial',
    lastName: 'Izer',
    password: '$2b$12$secret-hash',
    failedLoginAttempts: 3,
    lockedUntil: new Date('2030-01-01T00:00:00.000Z')
  });
}

@Public()
@Controller({ path: 'serializer-probe', version: '1' })
class PlainController {
  @Get('user')
  user(): User {
    return lockedUser();
  }

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return of({ data: lockedUser() });
  }
}

@Public()
@Controller({ path: 'serializer-probe-privileged', version: '1' })
@SerializeOptions({ groups: ['privileged'] })
class PrivilegedController {
  @Get('user')
  user(): User {
    return lockedUser();
  }
}

describe('Global response serializer', () => {
  let app: NestExpressApplication;
  let server: Server;

  beforeAll(async () => {
    jest.spyOn(DataSource.prototype, 'initialize').mockImplementation(function (
      this: DataSource
    ) {
      return Promise.resolve(this);
    });

    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot()],
      controllers: [PlainController, PrivilegedController]
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app?.close();
    jest.restoreAllMocks();
  });

  it('strips the @Exclude fields from a JSON response', async () => {
    const res = await request(server)
      .get('/api/v1/serializer-probe/user')
      .expect(200);

    expect(res.body).toMatchObject({ email: 'serializer@example.com' });
    expect(res.body).not.toHaveProperty('password');
    expect(res.body).not.toHaveProperty('failedLoginAttempts');
    expect(res.body).not.toHaveProperty('lockedUntil');
  });

  it('exposes a privileged field only under the @SerializeOptions groups of the controller', async () => {
    const res = await request(server)
      .get('/api/v1/serializer-probe-privileged/user')
      .expect(200);

    expect(res.body).toHaveProperty('lockedUntil', '2030-01-01T00:00:00.000Z');
    expect(res.body).not.toHaveProperty('password');
  });

  it('strips the @Exclude fields from each SSE event', async () => {
    const res = await request(server)
      .get('/api/v1/serializer-probe/stream')
      .expect(200);

    expect(res.text).toContain('serializer@example.com');
    expect(res.text).not.toContain('secret-hash');
    expect(res.text).not.toContain('failedLoginAttempts');
  });
});
