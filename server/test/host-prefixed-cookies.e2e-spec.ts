// Asserted over the wire: the browser applies the `__Host-` rules to the
// Set-Cookie header itself, so a name, a path or a Secure flag that a unit test
// sees on a mocked `res.cookie` call proves nothing about what reaches it.

import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { Server } from 'http';
import type { NextFunction, Request, Response } from 'express';
import { AuthController } from '../src/modules/auth/controllers/auth.controller';
import { OAuthController } from '../src/modules/auth/controllers/oauth.controller';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { OAuthService } from '../src/modules/auth/services/oauth.service';
import { OAuthAccountService } from '../src/modules/auth/services/oauth-account.service';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { TokenGeneratorService } from '../src/modules/auth/services/token-generator.service';
import { MailService } from '../src/modules/mail/mail.service';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { CaslAbilityFactory } from '../src/modules/auth/casl/casl-ability.factory';
import { MfaPolicyService } from '../src/modules/auth/services/mfa-policy.service';
import { GoogleOAuthGuard } from '../src/modules/auth/guards/google-oauth.guard';
import { LocalAuthGuard } from '../src/modules/auth/guards/local-auth.guard';
import { MfaRequiredGuard } from '../src/modules/auth/guards/mfa-required.guard';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';
import { CaptchaRequiredGuard } from '../src/modules/auth/captcha/captcha-required.guard';
import { UsersService } from '../src/modules/users/services/users.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { createMockCache } from '../src/common/testing/cache.mock';
import { BreachedPasswordService } from '../src/modules/auth/breached-password/breached-password.service';
import { SessionIssuerService } from '../src/modules/auth/services/session-issuer.service';
import { SessionLimitService } from '../src/modules/auth/services/session-limit.service';
import { EntitlementService } from '../src/modules/entitlements/entitlement.service';
import { User } from '../src/modules/users/entities/user.entity';
import { OAuthUserProfile } from '../src/modules/auth/types/oauth-profile';
import { CLIENT_URL } from '../src/modules/auth/providers/client-url.provider';
import { bindIntent } from '../src/modules/auth/utils/oauth-flow-intent';
import {
  DEFAULT_SESSION_ABSOLUTE_MAX_MS,
  STEP_UP_OPERATION,
  TOKEN_PURPOSE
} from '@app/shared/constants';

const FLOW_STATE = 'b'.repeat(64);

const tokens = {
  access_token: 'access-token',
  refresh_token: 'rotated-refresh-token',
  expires_in: 3600
};

const oauthProfile: OAuthUserProfile = {
  provider: 'google',
  providerId: 'google-123',
  email: 'user@example.com',
  firstName: 'John',
  lastName: 'Doe',
  emailVerified: true
};

function createUserEntity(): User {
  return Object.assign(new User(), {
    id: 'user-1',
    email: 'user@example.com',
    firstName: 'John',
    lastName: 'Doe',
    isActive: true,
    roles: [],
    isEmailVerified: true,
    locale: 'en',
    tokenRevokedAt: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    deletedAt: null
  });
}

function setCookiesOf(res: request.Response): string[] {
  return ([] as string[]).concat(res.headers['set-cookie'] ?? []);
}

function findCookie(res: request.Response, name: string): string | undefined {
  return setCookiesOf(res).find((cookie) => cookie.startsWith(`${name}=`));
}

/**
 * The three conditions under which a browser stores a `__Host-` cookie at all.
 * A clear is held to them too: an expiring write that fails them is dropped and
 * the cookie survives.
 */
function expectHostCookie(res: request.Response, name: string): string {
  const cookie = findCookie(res, `__Host-${name}`);
  expect(cookie).toBeDefined();
  const attributes = cookie!.split(/;\s*/).slice(1);
  expect(attributes).toContain('Path=/');
  expect(attributes).toContain('Secure');
  expect(attributes.some((a) => /^domain=/i.test(a))).toBe(false);
  return cookie!;
}

function isClear(cookie: string): boolean {
  return /^[^=]+=;/.test(cookie);
}

describe('`__Host-` auth cookies outside local (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let authService: AuthService;
  let jwtService: JwtService;
  let findByToken: jest.Mock;

  const configValues: Record<string, string> = {
    CLIENT_URL: 'http://localhost:4200',
    JWT_REFRESH_EXPIRATION: '604800',
    SESSION_ABSOLUTE_MAX_MS: String(DEFAULT_SESSION_ABSOLUTE_MAX_MS),
    ENVIRONMENT: 'production'
  };

  beforeEach(async () => {
    const userEntity = createUserEntity();
    findByToken = jest.fn().mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      revoked: false,
      createdAt: new Date(),
      sessionStartedAt: new Date(),
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      isExpired: () => false
    });

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret' })],
      controllers: [AuthController, OAuthController],
      providers: [
        { provide: CACHE_MANAGER, useValue: createMockCache() },
        {
          provide: BreachedPasswordService,
          useValue: { assertNotBreached: jest.fn() }
        },
        AuthService,
        {
          provide: MfaService,
          useValue: {
            isValidStepUpCode: jest.fn().mockResolvedValue(false),
            issuePendingToken: jest
              .fn()
              .mockReturnValue({ mfaToken: 'mfa', expiresIn: 300 })
          }
        },
        OAuthService,
        SessionIssuerService,
        SessionLimitService,
        {
          provide: EntitlementService,
          useValue: { limitFor: jest.fn().mockResolvedValue(null) }
        },
        { provide: CLIENT_URL, useValue: configValues['CLIENT_URL'] },
        {
          provide: DataSource,
          useValue: {
            transaction: (cb: (manager: unknown) => Promise<unknown>) =>
              cb({
                update: jest.fn().mockResolvedValue({ affected: 1 }),
                save: jest.fn()
              })
          }
        },
        {
          provide: RefreshTokenService,
          useValue: {
            findByToken,
            createRefreshToken: jest.fn(),
            pruneOldestTokens: jest.fn()
          }
        },
        {
          provide: OAuthAccountService,
          useValue: {
            findByProviderAndProviderId: jest.fn().mockResolvedValue({
              id: 'oauth-1',
              provider: 'google',
              providerId: 'google-123',
              userId: 'user-1'
            })
          }
        },
        {
          provide: UsersService,
          useValue: {
            findOne: jest.fn(() => Promise.resolve(userEntity)),
            findById: jest.fn(() => Promise.resolve(userEntity)),
            update: jest.fn(() => Promise.resolve(userEntity))
          }
        },
        { provide: RoleService, useValue: {} },
        {
          provide: TokenGeneratorService,
          useValue: { generateTokens: jest.fn(() => tokens) }
        },
        {
          provide: MailService,
          useValue: {
            sendPasswordChangedNotification: jest
              .fn()
              .mockResolvedValue(undefined)
          }
        },
        { provide: PermissionService, useValue: {} },
        { provide: CaslAbilityFactory, useValue: {} },
        {
          provide: MfaPolicyService,
          useValue: { appliesTo: jest.fn().mockResolvedValue(false) }
        },
        {
          provide: AuditService,
          useValue: { log: jest.fn(), logFireAndForget: jest.fn() }
        },
        { provide: MetricsService, useValue: { recordAuthEvent: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => configValues[key]),
            getOrThrow: jest.fn((key: string) => {
              const value = configValues[key];
              if (value === undefined) {
                throw new Error(`unexpected config key ${key}`);
              }
              return value;
            })
          }
        },
        Reflector
      ]
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CaptchaRequiredGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(LocalAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { user: User } };
        }) => {
          context.switchToHttp().getRequest().user = userEntity;
          return true;
        }
      })
      .overrideGuard(GoogleOAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { user: OAuthUserProfile } };
        }) => {
          context.switchToHttp().getRequest().user = oauthProfile;
          return true;
        }
      })
      .overrideGuard(MfaRequiredGuard)
      .useValue({ canActivate: () => true })
      .compile();

    authService = moduleRef.get(AuthService);
    jwtService = moduleRef.get(JwtService);

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.use(cookieParser());
    // The access-token guard is global in the application and absent here, so
    // the signed-in caller is attached the way that guard would attach it.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if (req.headers['x-test-user']) {
        Object.assign(req, {
          user: {
            userId: 'user-1',
            email: 'user@example.com',
            roles: ['user'],
            sessionId: 'session-1'
          }
        });
      }
      next();
    });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('POST /auth/login sets the prefixed refresh cookie and no bare one', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'user@example.com', password: 'irrelevant' })
      .expect(200);

    const cookie = expectHostCookie(res, 'refresh_token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(isClear(cookie)).toBe(false);

    expect(findCookie(res, 'refresh_token')).toBeUndefined();
  });

  it('POST /auth/refresh-token rotates the prefixed refresh cookie', async () => {
    const res = await request(server)
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', '__Host-refresh_token=current-refresh-token')
      .expect(200);

    expect(findByToken).toHaveBeenCalledWith('current-refresh-token');
    expect(expectHostCookie(res, 'refresh_token')).toMatch(
      /^__Host-refresh_token=rotated-refresh-token;/
    );
  });

  // A sibling host of the registrable domain can plant the bare name with a
  // valid token of its own. Accepting it signs the victim in to that account.
  it('POST /auth/refresh-token refuses a session of the bare name', async () => {
    const res = await request(server)
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', 'refresh_token=planted-refresh-token')
      .expect(401);

    expect(findByToken).not.toHaveBeenCalled();
    expect(findCookie(res, '__Host-refresh_token')).toBeUndefined();
  });

  it('POST /auth/logout clears the prefixed cookies with Secure', async () => {
    jest.spyOn(authService, 'logoutSession').mockResolvedValue(true);

    const res = await request(server)
      .post('/api/v1/auth/logout')
      .set('x-test-user', '1')
      .set('Cookie', '__Host-refresh_token=current-refresh-token')
      .expect(200);

    for (const name of [
      'refresh_token',
      'oauth_link',
      'oauth_reauth',
      'reauth_proof'
    ]) {
      expect(isClear(expectHostCookie(res, name))).toBe(true);
    }
  });

  it('PATCH /auth/profile with a new password clears the prefixed cookies with Secure', async () => {
    jest.spyOn(authService, 'assertStepUpForUser').mockResolvedValue();
    jest.spyOn(authService, 'logout').mockResolvedValue();

    const res = await request(server)
      .patch('/api/v1/auth/profile')
      .set('x-test-user', '1')
      .set('Cookie', '__Host-reauth_proof=proof-token')
      .send({ password: 'Unbreached-Pass-47', currentPassword: 'irrelevant' })
      .expect(200);

    for (const name of [
      'refresh_token',
      'oauth_link',
      'oauth_reauth',
      'reauth_proof'
    ]) {
      expect(isClear(expectHostCookie(res, name))).toBe(true);
    }
  });

  it('the OAuth callback and POST /auth/oauth/exchange use prefixed cookies', async () => {
    const callback = await request(server)
      .get('/api/v1/auth/oauth/google/callback')
      .expect(302);
    const data = expectHostCookie(callback, 'oauth_data');

    const exchange = await request(server)
      .post('/api/v1/auth/oauth/exchange')
      .set('Cookie', data.split(';')[0])
      .expect(201);

    expect(isClear(expectHostCookie(exchange, 'oauth_data'))).toBe(true);
    expect(expectHostCookie(exchange, 'refresh_token')).toMatch(
      /^__Host-refresh_token=rotated-refresh-token;/
    );
  });

  it('POST /auth/oauth/link-init sets the prefixed link intent', async () => {
    jest.spyOn(authService, 'assertStepUpForUser').mockResolvedValue();

    const res = await request(server)
      .post('/api/v1/auth/oauth/link-init')
      .set('x-test-user', '1')
      .send({ currentPassword: 'irrelevant' })
      .expect(201);

    expect(isClear(expectHostCookie(res, 'oauth_link'))).toBe(false);
    expect(isClear(expectHostCookie(res, 'reauth_proof'))).toBe(true);
  });

  it('POST /auth/oauth/reauth-init and its callback mint a prefixed proof', async () => {
    const init = await request(server)
      .post('/api/v1/auth/oauth/reauth-init')
      .set('x-test-user', '1')
      .send({ operation: STEP_UP_OPERATION.PASSWORD_SET })
      .expect(201);
    expectHostCookie(init, 'oauth_reauth');

    const intent = jwtService.sign({
      sub: 'user-1',
      purpose: TOKEN_PURPOSE.OAUTH_REAUTH,
      operation: STEP_UP_OPERATION.PASSWORD_SET
    });
    const callback = await request(server)
      .get(`/api/v1/auth/oauth/google/callback?state=${FLOW_STATE}`)
      .set('Cookie', `__Host-oauth_reauth=${bindIntent(intent, FLOW_STATE)}`)
      .expect(302);

    expect(callback.headers['location']).toBe(
      'http://localhost:4200/profile?reauth=ok'
    );
    expect(isClear(expectHostCookie(callback, 'oauth_reauth'))).toBe(true);
    expect(isClear(expectHostCookie(callback, 'reauth_proof'))).toBe(false);
  });

  // A sibling host can set the bare name for the parent domain. Outside the
  // refresh transition, a bare cookie must not steer a flow.
  it('ignores a bare reauth intent planted by a sibling host', async () => {
    const intent = jwtService.sign({
      sub: 'user-1',
      purpose: TOKEN_PURPOSE.OAUTH_REAUTH,
      operation: STEP_UP_OPERATION.PASSWORD_SET
    });
    const callback = await request(server)
      .get(`/api/v1/auth/oauth/google/callback?state=${FLOW_STATE}`)
      .set('Cookie', `oauth_reauth=${bindIntent(intent, FLOW_STATE)}`)
      .expect(302);

    expect(callback.headers['location']).toBe(
      'http://localhost:4200/oauth/callback'
    );
    expect(findCookie(callback, '__Host-reauth_proof')).toBeUndefined();
  });
});
