// The factor must survive the real request pipeline: the password rides in a
// DELETE body, which only the body parser and the global ValidationPipe make
// reachable, and the proof rides in a cookie that cookie-parser reads.

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import { Server } from 'http';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorKeys, STEP_UP_OPERATION } from '@app/shared/constants';
import { OAuthController } from '../src/modules/auth/controllers/oauth.controller';
import { OAuthService } from '../src/modules/auth/services/oauth.service';
import { OAuthAccountService } from '../src/modules/auth/services/oauth-account.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MailService } from '../src/modules/mail/mail.service';
import { CLIENT_URL } from '../src/modules/auth/providers/client-url.provider';

const USER_ID = 'user-1';

type StepUpCall = {
  userId: string;
  currentPassword: string | undefined;
  reauthProof: string | undefined;
  operation: string;
};

describe('DELETE /auth/oauth/accounts/:provider step-up (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let calls: StepUpCall[];
  let refuse: HttpException | null;
  let unlinkProvider: jest.Mock;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OAuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            assertStepUpForUser: jest.fn(
              (
                userId: string,
                currentPassword: string | undefined,
                reauthProof: string | undefined,
                operation: string
              ) => {
                calls.push({
                  userId,
                  currentPassword,
                  reauthProof,
                  operation
                });
                return refuse
                  ? Promise.reject(refuse)
                  : Promise.resolve(undefined);
              }
            )
          }
        },
        {
          provide: OAuthAccountService,
          useValue: {
            findByUserId: jest.fn().mockResolvedValue([]),
            unlinkProvider: jest.fn()
          }
        },
        { provide: OAuthService, useValue: {} },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), verify: jest.fn() }
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: AuditService,
          useValue: { log: jest.fn(), logFireAndForget: jest.fn() }
        },
        {
          provide: MailService,
          useValue: {
            sendOAuthUnlinkedNotification: jest
              .fn()
              .mockResolvedValue(undefined)
          }
        },
        { provide: CLIENT_URL, useValue: 'http://localhost:4200' },
        { provide: CACHE_MANAGER, useValue: { get: jest.fn(), set: jest.fn() } }
      ]
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.use(cookieParser());
    // The route reads the caller from the global JWT guard, which this
    // isolated module does not mount.
    app.use(
      (
        req: { user?: { userId: string; email: string; roles: string[] } },
        _res: unknown,
        next: () => void
      ) => {
        req.user = { userId: USER_ID, email: 'owner@example.com', roles: [] };
        next();
      }
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true
      })
    );
    await app.init();
    server = app.getHttpServer() as Server;

    unlinkProvider = moduleRef.get<{ unlinkProvider: jest.Mock }>(
      OAuthAccountService
    ).unlinkProvider;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calls = [];
    refuse = null;
    unlinkProvider.mockReset();
    unlinkProvider.mockResolvedValue({
      email: 'owner@example.com',
      locale: 'en'
    });
  });

  it('reads the password out of the DELETE body', async () => {
    await request(server)
      .delete('/auth/oauth/accounts/google')
      .send({ currentPassword: 'CurrentPassword123' })
      .expect(200);

    expect(calls).toEqual([
      {
        userId: USER_ID,
        currentPassword: 'CurrentPassword123',
        reauthProof: undefined,
        operation: STEP_UP_OPERATION.OAUTH_UNLINK
      }
    ]);
    expect(unlinkProvider).toHaveBeenCalledWith(USER_ID, 'google');
  });

  // An account created through a provider sends no password at all, and a
  // body-less DELETE must reach the handler rather than fail validation.
  it('accepts a request that carries no body', async () => {
    await request(server).delete('/auth/oauth/accounts/google').expect(200);

    expect(calls[0]?.currentPassword).toBeUndefined();
  });

  it('forwards the re-authentication proof cookie', async () => {
    await request(server)
      .delete('/auth/oauth/accounts/google')
      .set('Cookie', 'reauth_proof=proof-token')
      .expect(200);

    expect(calls[0]?.reauthProof).toBe('proof-token');
  });

  it('removes nothing when the step-up refuses the caller', async () => {
    refuse = new HttpException(
      {
        message: 'Current password is incorrect',
        errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
      },
      HttpStatus.BAD_REQUEST
    );

    const res = await request(server)
      .delete('/auth/oauth/accounts/google')
      .send({ currentPassword: 'WrongPassword1' })
      .expect(400);

    expect(res.body).toMatchObject({
      errorKey: ErrorKeys.AUTH.INVALID_CURRENT_PASSWORD
    });
    expect(unlinkProvider).not.toHaveBeenCalled();
  });

  it('rejects a password of the wrong shape', async () => {
    await request(server)
      .delete('/auth/oauth/accounts/google')
      .send({ currentPassword: '' })
      .expect(400);

    expect(calls).toEqual([]);
  });

  it('rejects an unknown property in the body', async () => {
    await request(server)
      .delete('/auth/oauth/accounts/google')
      .send({ currentPassword: 'CurrentPassword123', totpCode: '123456' })
      .expect(400);

    expect(calls).toEqual([]);
  });

  it('reports an unknown provider before it asks for a factor', async () => {
    const res = await request(server)
      .delete('/auth/oauth/accounts/myspace')
      .expect(400);

    expect(res.body).toMatchObject({
      errorKey: ErrorKeys.AUTH.INVALID_OAUTH_PROVIDER
    });
    expect(calls).toEqual([]);
  });
});
