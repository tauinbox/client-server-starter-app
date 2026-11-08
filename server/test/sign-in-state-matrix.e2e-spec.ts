import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  VersioningType
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'crypto';
import { Server } from 'http';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import {
  MAX_FAILED_ATTEMPTS,
  SIGN_IN_REFUSAL_REASONS,
  TOKEN_PURPOSE
} from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import {
  ACCOUNT_STATES,
  SCENARIO_PASSWORD,
  ScenarioAuditRow,
  AccountState,
  untilNextSecond
} from '@app/shared/utils/request-scenarios';
import type { SignedTokenRefusal } from '@app/shared/utils/token-revocation';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import { cookieName } from '../src/common/utils/host-cookie';
import { hashPassword } from '../src/common/utils/password-hash';
import { CoreModule } from '../src/modules/core/core.module';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import {
  OAUTH_LINK_COOKIE,
  OAUTH_REAUTH_COOKIE
} from '../src/modules/auth/constants/oauth.constants';
import { OAuthAccount } from '../src/modules/auth/entities/oauth-account.entity';
import { GoogleOAuthGuard } from '../src/modules/auth/guards/google-oauth.guard';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { AuthCookies } from '../src/modules/auth/utils/auth-cookies';
import { bindIntent } from '../src/modules/auth/utils/oauth-flow-intent';
import type { OAuthUserProfile } from '../src/modules/auth/types/oauth-profile';
import { User } from '../src/modules/users/entities/user.entity';
import { withPrivateThrottlerStorage } from './private-throttler';

// The provider rows of the sign-in state matrix. The mock has no provider
// callback, so the request scenarios cannot run them. Skips without DB_HOST.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const STATE = 'matrix';

type Flow = 'sign-in' | 'link' | 'step-up';

interface FlowSpec {
  /** The intent cookie that the flow claims; none for a sign-in. */
  intent?: { cookie: string; purpose: string };
  failure: AuditAction;
  /** The redirect of an accepted callback. */
  accepted: RegExp;
  acceptedRows: (state: AccountState) => ScenarioAuditRow[];
  /** The account states that refuse the flow, with their reason. */
  refusals: Partial<Record<AccountState, SignedTokenRefusal>>;
}

const ACCOUNT_REFUSALS = {
  'deactivated-actor': 'account_deactivated',
  'deleted-actor': 'account_not_found'
} as const;
const INTENT_REFUSALS = {
  ...ACCOUNT_REFUSALS,
  'revoked-actor': 'session_revoked'
} as const;

const FLOWS: Record<Flow, FlowSpec> = {
  // A provider sign-in is a new sign-in: a revocation before it ends nothing.
  // The provider asserts the address, so it verifies an unverified one.
  'sign-in': {
    failure: AuditAction.USER_LOGIN_FAILURE,
    accepted: /\/oauth\/callback$/,
    acceptedRows: (state) =>
      state === 'unverified-actor'
        ? [
            {
              action: AuditAction.EMAIL_VERIFIED,
              reason: null,
              target: 'actor'
            }
          ]
        : [],
    refusals: ACCOUNT_REFUSALS
  },
  link: {
    intent: { cookie: OAUTH_LINK_COOKIE, purpose: TOKEN_PURPOSE.OAUTH_LINK },
    failure: AuditAction.OAUTH_LINK_FAILURE,
    accepted: /\/profile\?oauth_linked=google$/,
    acceptedRows: () => [
      { action: AuditAction.OAUTH_LINK, reason: null, target: 'actor' }
    ],
    refusals: INTENT_REFUSALS
  },
  'step-up': {
    intent: {
      cookie: OAUTH_REAUTH_COOKIE,
      purpose: TOKEN_PURPOSE.OAUTH_REAUTH
    },
    failure: AuditAction.STEP_UP_FAILURE,
    accepted: /\/profile\?reauth=ok$/,
    acceptedRows: () => [],
    refusals: INTENT_REFUSALS
  }
};

interface MatrixCase {
  flow: Flow;
  state: AccountState;
  refusal?: SignedTokenRefusal;
}

const CASES: MatrixCase[] = (Object.keys(FLOWS) as Flow[]).flatMap((flow) =>
  ACCOUNT_STATES.map((state) => ({
    flow,
    state,
    refusal: FLOWS[flow].refusals[state]
  }))
);

runWithInfra('Sign-in state matrix of the provider callback (e2e)', () => {
  const previousKey = process.env['MFA_ENCRYPTION_KEY'];
  let app: INestApplication;
  let dataSource: DataSource;
  let secure: boolean;
  let profile: OAuthUserProfile;
  const emailPrefix = `sign-in-matrix-${Date.now()}-${randomBytes(3).toString('hex')}-`;
  let sequence = 0;

  const stubGuard: CanActivate = {
    canActivate: (context: ExecutionContext): boolean => {
      context.switchToHttp().getRequest<{ user: OAuthUserProfile }>().user =
        profile;

      return true;
    }
  };

  beforeAll(async () => {
    process.env['MFA_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    )
      .overrideGuard(GoogleOAuthGuard)
      .useValue(stubGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ApiValidationPipe());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);
    secure = app.get(AuthCookies).secure;
  }, 60000);

  afterAll(async () => {
    if (previousKey === undefined) delete process.env['MFA_ENCRYPTION_KEY'];
    else process.env['MFA_ENCRYPTION_KEY'] = previousKey;

    if (dataSource) {
      const ids = (
        await dataSource
          .getRepository(User)
          .createQueryBuilder('u')
          .withDeleted()
          .where('u.email LIKE :prefix', { prefix: `${emailPrefix}%` })
          .getMany()
      ).map((u) => u.id);

      if (ids.length > 0) {
        await dataSource.getRepository(AuditLog).delete({ actorId: In(ids) });
        await dataSource.getRepository(AuditLog).delete({ targetId: In(ids) });
        await dataSource.getRepository(User).delete({ id: In(ids) });
      }
    }

    await app?.close();
  });

  /**
   * An account with a password and a verified address. The sign-in and the
   * step-up use its linked `google` identity; a link adds a new one.
   */
  async function createAccount(flow: Flow): Promise<User> {
    sequence += 1;
    const users = dataSource.getRepository(User);
    const { hash, version } = await hashPassword(SCENARIO_PASSWORD);
    const user = await users.save(
      users.create({
        email: `${emailPrefix}${sequence}@example.com`,
        name: 'Matrix Owner',
        password: hash,
        passwordHashVersion: version,
        isEmailVerified: true
      })
    );
    const linked = {
      provider: 'google',
      providerId: `google-${user.id}`
    };

    if (flow !== 'link') {
      await dataSource
        .getRepository(OAuthAccount)
        .save({ userId: user.id, ...linked });
    }

    profile = {
      ...linked,
      ...(flow === 'link' && { providerId: `google-new-${user.id}` }),
      email: user.email,
      name: user.name,
      emailVerified: true
    };

    return user;
  }

  const STATES: Record<AccountState, (user: User) => Promise<unknown>> = {
    'deactivated-actor': (user) =>
      dataSource.getRepository(User).update(user.id, { isActive: false }),
    'deleted-actor': (user) =>
      dataSource.getRepository(User).softDelete(user.id),
    // An intent keeps its issue time in whole seconds.
    'revoked-actor': async (user) => {
      await untilNextSecond();
      await app.get(AuthService).revokeAllUserSessions(user.id);
    },
    'locked-actor': (user) =>
      dataSource.getRepository(User).update(user.id, {
        failedLoginAttempts: MAX_FAILED_ATTEMPTS,
        lockedUntil: new Date(Date.now() + 3600_000)
      }),
    'unverified-actor': (user) =>
      dataSource
        .getRepository(User)
        .update(user.id, { isEmailVerified: false }),
    'passwordless-actor': (user) =>
      dataSource.getRepository(User).update(user.id, { password: null })
  };

  function intentCookie(
    { cookie, purpose }: NonNullable<FlowSpec['intent']>,
    user: User
  ): string {
    const token = app.get(JwtService).sign(
      {
        sub: user.id,
        email: user.email,
        purpose,
        operation: 'email_change'
      },
      { expiresIn: 300 }
    );

    return `${cookieName(cookie, secure)}=${bindIntent(token, STATE)}`;
  }

  /** The redirect of the callback and the rows that its request wrote. */
  async function callback(cookie: string | undefined, user: User) {
    const requestId = `${emailPrefix}${randomBytes(6).toString('hex')}`;
    const req = request(app.getHttpServer() as Server)
      .get(`/api/v1/auth/oauth/google/callback?state=${STATE}`)
      .set('X-Request-Id', requestId);

    if (cookie) req.set('Cookie', cookie);

    const res = await req.expect(302);
    const repository = dataSource.getRepository(AuditLog);

    // Fire-and-forget rows land after the redirect.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const rows = await repository.find({ where: { requestId } });

    await repository.delete({ requestId });

    return {
      location: res.headers['location'],
      rows: rows.map((row): ScenarioAuditRow => ({
        action: row.action,
        reason:
          typeof row.details?.['reason'] === 'string'
            ? row.details['reason']
            : null,
        target: row.targetId === user.id ? 'actor' : 'none'
      }))
    };
  }

  async function run({ flow, state, refusal }: MatrixCase) {
    const spec = FLOWS[flow];
    const user = await createAccount(flow);
    const cookie = spec.intent && intentCookie(spec.intent, user);

    await STATES[state](user);
    const { location, rows } = await callback(cookie, user);

    for (const { reason } of rows) {
      if (reason !== null) expect(SIGN_IN_REFUSAL_REASONS).toContain(reason);
    }

    if (refusal) {
      expect(location).not.toMatch(spec.accepted);
      expect(rows).toEqual([
        { action: spec.failure, reason: refusal, target: 'actor' }
      ]);
    } else {
      expect(location).toMatch(spec.accepted);
      expect(rows).toEqual(spec.acceptedRows(state));
    }
  }

  const title = '%s with %s';
  const accepted = CASES.filter((c) => !c.refusal);
  const refused = CASES.filter((c) => c.refusal);

  it.each(accepted.map((c) => [c.flow, c.state, c] as const))(
    `accepts the ${title}`,
    async (_flow, _state, matrixCase) => run(matrixCase),
    30000
  );

  // The provider halves still write the error key as the reason, and a
  // soft-deleted owner of a linked identity is not named.
  it.failing.each(refused.map((c) => [c.flow, c.state, c] as const))(
    `refuses the ${title} and names the account`,
    async (_flow, _state, matrixCase) => run(matrixCase),
    30000
  );
});
