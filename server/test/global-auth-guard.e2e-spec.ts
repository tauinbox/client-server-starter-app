import {
  Controller,
  Get,
  INestApplication,
  Module,
  Post
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { Strategy } from 'passport-jwt';
import * as request from 'supertest';
import { Server } from 'http';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { Public } from '../src/modules/auth/decorators/public.decorator';

const TEST_JWT_SECRET = 'test-secret-for-global-guard-e2e';

class TestJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: (req: { headers?: Record<string, string> }) => {
        const auth = req.headers?.['authorization'];
        if (!auth?.startsWith('Bearer ')) return null;
        return auth.substring(7);
      },
      ignoreExpiration: false,
      secretOrKey: TEST_JWT_SECRET
    });
  }

  validate(payload: { sub: string }) {
    return { userId: payload.sub };
  }
}

@Controller('public-class')
@Public()
class PublicClassController {
  @Get('echo')
  echo(): { ok: true } {
    return { ok: true };
  }
}

@Controller('mixed')
class MixedController {
  @Public()
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }

  @Get('locked')
  locked(): { ok: true } {
    return { ok: true };
  }

  @Public()
  @Post('echo')
  echo(): { ok: true } {
    return { ok: true };
  }
}

@Controller('protected')
class ProtectedController {
  @Get('one')
  one(): { ok: true } {
    return { ok: true };
  }

  @Post('two')
  two(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({ ignoreEnvFile: true }),
    PassportModule,
    JwtModule.register({ secret: TEST_JWT_SECRET })
  ],
  controllers: [PublicClassController, MixedController, ProtectedController],
  providers: [TestJwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }]
})
class GlobalGuardTestModule {}

describe('Global JwtAuthGuard (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GlobalGuardTestModule]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  describe('routes WITHOUT token', () => {
    it('returns 401 for protected route (no @Public)', async () => {
      await request(http()).get('/protected/one').expect(401);
      await request(http()).post('/protected/two').expect(401);
    });

    it('returns 401 for non-public route on a controller with mixed handlers', async () => {
      await request(http()).get('/mixed/locked').expect(401);
    });

    it('returns 200 for handler-level @Public()', async () => {
      await request(http()).get('/mixed/open').expect(200).expect({ ok: true });

      await request(http())
        .post('/mixed/echo')
        .expect(201)
        .expect({ ok: true });
    });

    it('returns 200 for class-level @Public()', async () => {
      await request(http())
        .get('/public-class/echo')
        .expect(200)
        .expect({ ok: true });
    });
  });

  describe('routes WITH valid token', () => {
    let token: string;

    beforeAll(() => {
      const jwt = app.get(JwtService);
      token = jwt.sign({ sub: 'user-1' });
    });

    it('grants access to protected route', async () => {
      await request(http())
        .get('/protected/one')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect({ ok: true });
    });
  });
});
