import type { INestApplication } from '@nestjs/common';
import {
  Controller,
  Get,
  Logger,
  Req,
  UseFilters,
  UseGuards
} from '@nestjs/common';
import type { Server } from 'http';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import type { Request as ExpressRequest } from 'express';
import * as passport from 'passport';
import * as request from 'supertest';
import { createOAuthProviderGuard } from './oauth-provider.guard';
import { OAuthAuthenticationExceptionFilter } from '../filters/oauth-authentication-exception.filter';
import { CLIENT_URL } from '../providers/client-url.provider';

const CLIENT = 'http://localhost:4200';

/**
 * Drives the real Passport pipeline rather than a mocked AuthGuard: the defect
 * lives in the hand-off between Passport's fail/error actions and Nest's
 * handleRequest, so a mocked base guard cannot exercise it.
 */
class ScriptedStrategy implements passport.Strategy {
  // Both members are public: passport re-creates the strategy through
  // Object.create, and StrategyCreated<T> only carries its public shape.
  constructor(
    readonly name: string,
    readonly action: 'fail' | 'error' | 'success'
  ) {}

  authenticate(this: passport.StrategyCreated<ScriptedStrategy>): void {
    if (this.action === 'fail') {
      // What passport-oauth2 does when the state cookie is missing or expired
      // (strategy.js:163) and when the provider returns error=access_denied
      // (strategy.js:136).
      this.fail({ message: 'Invalid authorization request state.' }, 403);
      return;
    }
    if (this.action === 'error') {
      this.error(new Error('Failed to obtain access token'));
      return;
    }
    this.success({ email: 'user@example.com' });
  }
}

const FailingGuard = createOAuthProviderGuard('scripted-fail', 'Test');
const ErroringGuard = createOAuthProviderGuard('scripted-error', 'Test');
const SucceedingGuard = createOAuthProviderGuard('scripted-success', 'Test');
const UnregisteredGuard = createOAuthProviderGuard('scripted-absent', 'Test');

@Controller('oauth')
@UseFilters(OAuthAuthenticationExceptionFilter)
class ScriptedOAuthController {
  @Get('fail/callback')
  @UseGuards(FailingGuard)
  failCallback(): string {
    return 'reached';
  }

  @Get('error/callback')
  @UseGuards(ErroringGuard)
  errorCallback(): string {
    return 'reached';
  }

  @Get('success/callback')
  @UseGuards(SucceedingGuard)
  successCallback(@Req() req: ExpressRequest): unknown {
    return req.user;
  }

  @Get('absent/callback')
  @UseGuards(UnregisteredGuard)
  absentCallback(): string {
    return 'reached';
  }
}

describe('createOAuthProviderGuard (real Passport pipeline)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    passport.use(new ScriptedStrategy('scripted-fail', 'fail'));
    passport.use(new ScriptedStrategy('scripted-error', 'error'));
    passport.use(new ScriptedStrategy('scripted-success', 'success'));

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ScriptedOAuthController],
      providers: [
        OAuthAuthenticationExceptionFilter,
        { provide: CLIENT_URL, useValue: CLIENT }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    passport.unuse('scripted-fail');
    passport.unuse('scripted-error');
    passport.unuse('scripted-success');
    await app.close();
    jest.restoreAllMocks();
  });

  it('redirects to the client login page when Passport fails the request', async () => {
    const response = await request(server).get('/oauth/fail/callback');

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe(
      `${CLIENT}/login?oauth_error=auth_failed`
    );
    expect(response.body).toEqual({});
  });

  it('redirects to the client login page when the strategy errors', async () => {
    const response = await request(server).get('/oauth/error/callback');

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe(
      `${CLIENT}/login?oauth_error=auth_failed`
    );
  });

  it('passes the authenticated profile through to the handler', async () => {
    const response = await request(server).get('/oauth/success/callback');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ email: 'user@example.com' });
  });

  it('still answers 404 when the provider is not configured', async () => {
    const response = await request(server).get('/oauth/absent/callback');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      message: 'Test OAuth is not configured'
    });
  });
});
