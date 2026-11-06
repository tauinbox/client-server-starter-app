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
import passport from 'passport';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createOAuthProviderGuard } from './oauth-provider.guard';
import { OAuthAuthenticationExceptionFilter } from '../filters/oauth-authentication-exception.filter';
import { CLIENT_URL } from '../providers/client-url.provider';
import { AuthCookies } from '../utils/auth-cookies';
import { OAuthFailureAudit } from '../utils/oauth-failure-audit';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import { AuditService } from '../../audit/audit.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { PurposeTokenService } from '../services/purpose-token.service';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { bindIntent } from '../utils/oauth-flow-intent';

const CLIENT = 'http://localhost:4200';
const FLOW_STATE = 'b'.repeat(32);
const OTHER_STATE = 'a'.repeat(32);

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

const TEST_PROVIDER = { provider: OAuthProvider.GOOGLE, displayName: 'Test' };
const FailingGuard = createOAuthProviderGuard('scripted-fail', TEST_PROVIDER);
const ErroringGuard = createOAuthProviderGuard('scripted-error', TEST_PROVIDER);
const SucceedingGuard = createOAuthProviderGuard(
  'scripted-success',
  TEST_PROVIDER
);
const UnregisteredGuard = createOAuthProviderGuard(
  'scripted-absent',
  TEST_PROVIDER
);

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
  const auditService = { logFireAndForget: jest.fn() };

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
        OAuthFailureAudit,
        { provide: AuditService, useValue: auditService },
        { provide: MetricsService, useValue: { recordAuthEvent: jest.fn() } },
        { provide: PurposeTokenService, useValue: { verify: () => null } },
        AuthCookies,
        { provide: CLIENT_URL, useValue: CLIENT },
        { provide: ConfigService, useValue: { get: () => 'production' } }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    // main.ts applies the same parser, and the link-flow branch reads req.cookies.
    app.use(cookieParser());
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

  it('writes a refused sign-in row that names the provider of the guard', async () => {
    auditService.logFireAndForget.mockClear();

    await request(server).get('/oauth/fail/callback');

    expect(auditService.logFireAndForget).toHaveBeenCalledTimes(1);
    expect(auditService.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.USER_LOGIN_FAILURE,
        details: { method: 'oauth', provider: 'google', reason: 'auth_failed' }
      })
    );
  });

  it('redirects to the client login page when the strategy errors', async () => {
    const response = await request(server).get('/oauth/error/callback');

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe(
      `${CLIENT}/login?oauth_error=auth_failed`
    );
  });

  it('reports a declined consent screen as a cancellation', async () => {
    const response = await request(server).get(
      '/oauth/fail/callback?error=access_denied'
    );

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe(
      `${CLIENT}/login?oauth_error=oauth_cancelled`
    );
  });

  it('returns a cancelled link flow to the profile page and clears the link cookie', async () => {
    const response = await request(server)
      .get(`/oauth/fail/callback?error=access_denied&state=${FLOW_STATE}`)
      .set(
        'Cookie',
        `__Host-oauth_link=${bindIntent('link-token', FLOW_STATE)}`
      );

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe(
      `${CLIENT}/profile?oauth_error=oauth_cancelled`
    );
    expect(response.headers['set-cookie']).toEqual([
      expect.stringMatching(/^__Host-oauth_link=;.*Path=\/;.*Secure/)
    ]);
  });

  it('returns a cancelled step-up to the profile page and clears the reauth cookie', async () => {
    const response = await request(server)
      .get(`/oauth/fail/callback?error=access_denied&state=${FLOW_STATE}`)
      .set(
        'Cookie',
        `__Host-oauth_reauth=${bindIntent('reauth-token', FLOW_STATE)}`
      );

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe(
      `${CLIENT}/profile?oauth_error=reauth_failed`
    );
    expect(response.headers['set-cookie']).toEqual([
      expect.stringMatching(/^__Host-oauth_reauth=;.*Path=\/;.*Secure/)
    ]);
  });

  it('sends a failed plain sign-in to the login page when the intent belongs to another flow and keeps that intent', async () => {
    auditService.logFireAndForget.mockClear();

    const response = await request(server)
      .get(`/oauth/fail/callback?error=access_denied&state=${FLOW_STATE}`)
      .set('Cookie', [
        `__Host-oauth_reauth=${bindIntent('reauth-token', OTHER_STATE)}`,
        `__Host-oauth_link=${bindIntent('link-token', OTHER_STATE)}`
      ]);

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe(
      `${CLIENT}/login?oauth_error=oauth_cancelled`
    );
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(auditService.logFireAndForget).toHaveBeenCalledTimes(1);
    expect(auditService.logFireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.USER_LOGIN_FAILURE })
    );
  });

  it('clears only the claimed reauth intent when the link intent belongs to another flow', async () => {
    const response = await request(server)
      .get(`/oauth/fail/callback?error=access_denied&state=${FLOW_STATE}`)
      .set('Cookie', [
        `__Host-oauth_reauth=${bindIntent('reauth-token', FLOW_STATE)}`,
        `__Host-oauth_link=${bindIntent('link-token', OTHER_STATE)}`
      ]);

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe(
      `${CLIENT}/profile?oauth_error=reauth_failed`
    );
    expect(response.headers['set-cookie']).toEqual([
      expect.stringMatching(/^__Host-oauth_reauth=;.*Path=\/;.*Secure/)
    ]);
  });

  it('keeps an attacker-supplied error value out of the redirect', async () => {
    const response = await request(server).get(
      '/oauth/fail/callback?error=' +
        encodeURIComponent('https://evil.example/#')
    );

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
