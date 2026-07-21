// Regression guard: an `oauth_data` token carries no `sub`, so the user lookup
// ran unconstrained and matched the first row - the seeded admin on a fresh
// deployment. Built on the production JwtModule options, so it also fails if
// signing and verification ever disagree on issuer/audience.

import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as request from 'supertest';
import type { Server } from 'http';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { buildJwtModuleOptions } from '../src/modules/auth/jwt-module-options.factory';
import { TOKEN_PURPOSE } from '@app/shared/constants/auth.constants';

const TEST_SECRET = 'test-secret-for-token-purpose-e2e';

// Mirrors the vulnerable behaviour: an id-less lookup used to match the first
// row rather than nothing, so this stub answers every query with that row.
const FIRST_ROW_IN_USERS_TABLE = { id: 'seeded-admin', tokenRevokedAt: null };

@Controller('protected')
class ProtectedController {
  @Get()
  whoami(): { ok: true } {
    return { ok: true };
  }
}

describe('JWT token purpose (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let jwt: JwtService;

  beforeAll(async () => {
    const config = new ConfigService({
      JWT_ALGORITHM: 'HS256',
      JWT_EXPIRATION: '3600',
      JWT_SECRET: TEST_SECRET
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register(buildJwtModuleOptions(config))
      ],
      controllers: [ProtectedController],
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: config },
        {
          provide: DataSource,
          useValue: {
            getRepository: () => ({
              findOne: () => Promise.resolve(FIRST_ROW_IN_USERS_TABLE)
            })
          }
        }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalGuards(new JwtAuthGuard(new Reflector()));
    await app.init();
    server = app.getHttpServer() as Server;
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a genuine access token', async () => {
    const token = jwt.sign({
      sub: 'user-1',
      email: 'user@example.com',
      roles: ['user'],
      purpose: TOKEN_PURPOSE.ACCESS
    });

    await request(server)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('rejects an OAuth-data token used as a bearer token', async () => {
    const token = jwt.sign({
      data: { tokens: {}, user: {} },
      purpose: TOKEN_PURPOSE.OAUTH_DATA
    });

    await request(server)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects an OAuth-link token even though it carries a subject', async () => {
    const token = jwt.sign({
      sub: 'user-1',
      purpose: TOKEN_PURPOSE.OAUTH_LINK
    });

    await request(server)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a token signed for a different issuer', async () => {
    const foreign = new JwtService({
      secret: TEST_SECRET,
      signOptions: { issuer: 'someone-else', audience: 'someone-else' }
    });
    const token = foreign.sign({
      sub: 'user-1',
      email: 'user@example.com',
      purpose: TOKEN_PURPOSE.ACCESS
    });

    await request(server)
      .get('/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
