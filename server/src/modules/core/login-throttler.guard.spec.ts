import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UnauthorizedException
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import type { Server } from 'http';
import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS
} from '@app/shared/constants';
import { CountFailuresOnlyWhenBody } from './failure-counter.decorator';
import { LoginThrottlerGuard } from './login-throttler.guard';
import { buildThrottlerOptions } from './throttler-options';

@Controller('probe')
class ProbeController {
  // Mirrors the real login route: the same handler answers both outcomes, so
  // successes and failures share one throttler key.
  @Throttle({
    default: { ttl: 60000, limit: 1000 },
    'login-long-window': {
      ttl: LOCKOUT_DURATION_MS,
      limit: MAX_FAILED_ATTEMPTS - 1
    }
  })
  @Get('login')
  login(@Query('fail') fail?: string): { ok: boolean } {
    if (fail) {
      throw new UnauthorizedException();
    }
    return { ok: true };
  }

  // Mirrors PATCH /auth/profile: one handler answers a password change, which
  // verifies a secret, and a name change, which verifies none.
  @Throttle({
    default: { ttl: 60000, limit: 1000 },
    'login-long-window': {
      ttl: LOCKOUT_DURATION_MS,
      limit: MAX_FAILED_ATTEMPTS - 1
    }
  })
  @CountFailuresOnlyWhenBody('password')
  @Post('profile')
  profile(@Body() body: { password?: string; firstName?: string }): {
    ok: boolean;
  } {
    if (body.password) {
      throw new UnauthorizedException();
    }
    if (body.firstName === 'bad') {
      throw new BadRequestException();
    }
    return { ok: true };
  }
}

describe('LoginThrottlerGuard', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(buildThrottlerOptions(undefined))],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: LoginThrottlerGuard }]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const login = async (fail: boolean): Promise<number> => {
    const res = await request(app.getHttpServer() as Server).get(
      fail ? '/probe/login?fail=1' : '/probe/login'
    );
    return res.status;
  };

  const repeat = async (times: number, fail: boolean): Promise<number[]> => {
    const statuses: number[] = [];
    for (let i = 0; i < times; i++) {
      statuses.push(await login(fail));
    }
    return statuses;
  };

  it('refunds successful logins, so they never spend the failed-attempt budget', async () => {
    await expect(repeat(MAX_FAILED_ATTEMPTS + 2, false)).resolves.toEqual([
      200, 200, 200, 200, 200, 200, 200
    ]);
  });

  it('counts failed logins and blocks the attempt that would trigger lockout', async () => {
    await expect(repeat(MAX_FAILED_ATTEMPTS, true)).resolves.toEqual([
      401, 401, 401, 401, 429
    ]);
  });

  const profile = async (body: Record<string, string>): Promise<number> => {
    const res = await request(app.getHttpServer() as Server)
      .post('/probe/profile')
      .send(body);
    return res.status;
  };

  it('never spends the failure budget on a refused request that carries no secret', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < MAX_FAILED_ATTEMPTS + 2; i++) {
      statuses.push(await profile({ firstName: 'bad' }));
    }

    expect(statuses).toEqual([400, 400, 400, 400, 400, 400, 400]);
  });

  it('counts the refused requests that do carry a secret', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      statuses.push(await profile({ password: 'WrongPass1' }));
    }

    expect(statuses).toEqual([401, 401, 401, 401, 429]);
  });

  it('keeps the secret budget intact after refused requests that carry none', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS + 2; i++) {
      await profile({ firstName: 'bad' });
    }

    const statuses: number[] = [];
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      statuses.push(await profile({ password: 'WrongPass1' }));
    }

    expect(statuses).toEqual([401, 401, 401, 401, 429]);
  });

  it('leaves the failed-attempt budget intact after refunded successes', async () => {
    await repeat(MAX_FAILED_ATTEMPTS + 2, false);

    await expect(repeat(MAX_FAILED_ATTEMPTS, true)).resolves.toEqual([
      401, 401, 401, 401, 429
    ]);
  });
});
