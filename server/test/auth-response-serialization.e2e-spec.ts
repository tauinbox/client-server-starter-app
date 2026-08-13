// Asserted over the wire, not at service level: ClassSerializerInterceptor is
// invisible to a service-level check, and the OAuth user is serialized before
// it is signed into the oauth_data cookie that /exchange echoes back.

import { Test } from '@nestjs/testing';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { Server } from 'http';
import { AuthController } from '../src/modules/auth/controllers/auth.controller';
import { OAuthController } from '../src/modules/auth/controllers/oauth.controller';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { OAuthService } from '../src/modules/auth/services/oauth.service';
import { OAuthAccountService } from '../src/modules/auth/services/oauth-account.service';
import { RefreshTokenService } from '../src/modules/auth/services/refresh-token.service';
import { RoleService } from '../src/modules/auth/services/role.service';
import { TokenGeneratorService } from '../src/modules/auth/services/token-generator.service';
import { MailService } from '../src/modules/mail/mail.service';
import { PermissionService } from '../src/modules/auth/services/permission.service';
import { CaslAbilityFactory } from '../src/modules/auth/casl/casl-ability.factory';
import { GoogleOAuthGuard } from '../src/modules/auth/guards/google-oauth.guard';
import { PermissionsGuard } from '../src/modules/auth/guards/permissions.guard';
import { CaptchaRequiredGuard } from '../src/modules/auth/captcha/captcha-required.guard';
import { UsersService } from '../src/modules/users/services/users.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MetricsService } from '../src/modules/core/metrics/metrics.service';
import { SessionLimitService } from '../src/modules/auth/services/session-limit.service';
import { EntitlementService } from '../src/modules/billing/entitlements/entitlement.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { OAuthUserProfile } from '../src/modules/auth/types/oauth-profile';
import { CLIENT_URL } from '../src/modules/auth/providers/client-url.provider';

const PUBLIC_USER_FIELDS = [
  'id',
  'email',
  'firstName',
  'lastName',
  'isActive',
  'roles',
  'isEmailVerified',
  'locale',
  'createdAt',
  'updatedAt',
  'deletedAt'
];

const PUBLIC_ROLE_FIELDS = [
  'id',
  'name',
  'description',
  'createdAt',
  'updatedAt'
];

// Every field the User entity hides via @Exclude(), plus lockedUntil, which is
// gated behind the 'privileged' group and must not surface on auth endpoints.
const HIDDEN_USER_FIELDS = [
  'password',
  'failedLoginAttempts',
  'lockedUntil',
  'emailVerificationToken',
  'emailVerificationExpiresAt',
  'passwordResetToken',
  'passwordResetExpiresAt',
  'pendingEmail',
  'pendingEmailToken',
  'pendingEmailExpiresAt',
  'tokenRevokedAt'
];

function createUserEntity(): User {
  const role = Object.assign(new Role(), {
    id: 'role-1',
    name: 'user',
    description: null,
    isSystem: true,
    isSuper: false,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-01T00:00:00.000Z')
  });

  return Object.assign(new User(), {
    id: 'user-1',
    email: 'user@example.com',
    firstName: 'John',
    lastName: 'Doe',
    password: '$2b$10$hashedpassword',
    isActive: true,
    roles: [role],
    failedLoginAttempts: 3,
    lockedUntil: new Date('2025-06-01T00:00:00.000Z'),
    isEmailVerified: true,
    locale: 'en',
    emailVerificationToken: 'hashed-verification-token',
    emailVerificationExpiresAt: new Date('2025-06-02T00:00:00.000Z'),
    passwordResetToken: 'hashed-reset-token',
    passwordResetExpiresAt: new Date('2025-06-03T00:00:00.000Z'),
    pendingEmail: 'new@example.com',
    pendingEmailToken: 'hashed-pending-token',
    pendingEmailExpiresAt: new Date('2025-06-04T00:00:00.000Z'),
    tokenRevokedAt: new Date('2025-05-01T00:00:00.000Z'),
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-02-01T00:00:00.000Z'),
    deletedAt: null
  });
}

const tokens = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
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

function expectPublicUserShape(user: Record<string, unknown>): void {
  expect(Object.keys(user).sort()).toEqual([...PUBLIC_USER_FIELDS].sort());
  for (const field of HIDDEN_USER_FIELDS) {
    expect(user).not.toHaveProperty(field);
  }

  const roles = user['roles'] as Record<string, unknown>[];
  expect(roles).toHaveLength(1);
  expect(Object.keys(roles[0]).sort()).toEqual([...PUBLIC_ROLE_FIELDS].sort());
}

describe('Auth response serialization (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let userEntity: User;

  const configValues: Record<string, string> = {
    CLIENT_URL: 'http://localhost:4200',
    JWT_REFRESH_EXPIRATION: '604800'
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    userEntity = createUserEntity();

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret' })],
      controllers: [AuthController, OAuthController],
      providers: [
        AuthService,
        OAuthService,
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
              cb({ update: jest.fn(), save: jest.fn() })
          }
        },
        {
          provide: RefreshTokenService,
          useValue: {
            findByToken: jest.fn().mockResolvedValue({
              id: 'token-1',
              userId: 'user-1',
              revoked: false,
              createdAt: new Date('2025-01-01T00:00:00.000Z'),
              expiresAt: new Date('2099-01-01T00:00:00.000Z'),
              isExpired: () => false
            }),
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
          useValue: { findOne: jest.fn(() => Promise.resolve(userEntity)) }
        },
        { provide: RoleService, useValue: {} },
        {
          provide: TokenGeneratorService,
          useValue: { generateTokens: jest.fn(() => tokens) }
        },
        { provide: MailService, useValue: {} },
        { provide: PermissionService, useValue: {} },
        { provide: CaslAbilityFactory, useValue: {} },
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
      .overrideGuard(GoogleOAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { user: OAuthUserProfile } };
        }) => {
          context.switchToHttp().getRequest().user = oauthProfile;
          return true;
        }
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    app.use(cookieParser());
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /auth/refresh-token returns only the public user fields', async () => {
    const res = await request(server)
      .post('/api/v1/auth/refresh-token')
      .set('Cookie', 'refresh_token=some-refresh-token')
      .expect(200);

    const body = res.body as { user: Record<string, unknown> };
    expectPublicUserShape(body.user);
  });

  it('POST /auth/oauth/exchange returns only the public user fields', async () => {
    // The agent carries the oauth_data cookie set by the callback redirect
    // through to the exchange call, exercising the real sign -> verify path.
    const agent = request.agent(server);
    await agent.get('/api/v1/auth/oauth/google/callback').expect(302);

    const res = await agent.post('/api/v1/auth/oauth/exchange').expect(201);

    const body = res.body as { user: Record<string, unknown> };
    expectPublicUserShape(body.user);
  });
});
