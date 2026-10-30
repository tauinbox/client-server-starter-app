import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  VersioningType
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'crypto';
import { Server } from 'http';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { generateSync } from 'otplib';
import {
  MAX_FAILED_ATTEMPTS,
  requiresSecureCookies
} from '@app/shared/constants';
import { normalizeOtpCode } from '@app/shared/utils/otp-code';
import {
  ACTOR_FIXTURES,
  ActorFixture,
  expectedAnswers,
  loadScenarioFiles,
  RequestScenario,
  resolvePlaceholders,
  SCENARIO_NEW_PASSWORD,
  SCENARIO_PASSWORD,
  SCENARIO_RECOVERY_CODE,
  ScenarioPlaceholder,
  scenarioMethod,
  scenarioPath,
  StateFixture
} from '@app/shared/utils/request-scenarios';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import { SecretEncryptionService } from '../src/common/crypto/secret-encryption.service';
import { hashPassword } from '../src/common/utils/password-hash';
import { hashToken } from '../src/common/utils/hash-token';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { GoogleOAuthGuard } from '../src/modules/auth/guards/google-oauth.guard';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { MailService } from '../src/modules/mail/mail.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { User } from '../src/modules/users/entities/user.entity';
import { Role } from '../src/modules/auth/entities/role.entity';
import { Permission } from '../src/modules/auth/entities/permission.entity';
import { RolePermission } from '../src/modules/auth/entities/role-permission.entity';
import { OAuthAccount } from '../src/modules/auth/entities/oauth-account.entity';
import { Resource } from '../src/modules/auth/entities/resource.entity';
import { ResourceRegistryService } from '../src/modules/auth/services/resource-registry.service';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import type { OAuthUserProfile } from '../src/modules/auth/types/oauth-profile';
import { MemoryThrottlerStorage } from '../src/modules/core/memory-throttler.storage';
import type { DecrementableThrottlerStorage } from '../src/modules/core/throttler-storage.interface';

// Runs every scenario of contracts/scenarios against the real server and the
// real database. The mock server runs the same files, so a difference in a
// status, an error key or an audit row fails one of the two runs.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const WRONG_CODE = '000000';
// Fire-and-forget audit writes land after the answer.
const AUDIT_SETTLE_MS = 300;
const AUDIT_WAIT_MS = 3000;

// Each scenario starts with a full rate-limit budget. Rate limiting is an
// allowed difference from the mock, so no scenario may depend on a 429.
class PerScenarioThrottlerStorage implements DecrementableThrottlerStorage {
  private inner = new MemoryThrottlerStorage();

  reset(): void {
    this.inner.onApplicationShutdown();
    this.inner = new MemoryThrottlerStorage();
  }

  increment(...args: Parameters<MemoryThrottlerStorage['increment']>) {
    return this.inner.increment(...args);
  }

  decrement(key: string): Promise<void> {
    return this.inner.decrement(key);
  }

  onApplicationShutdown(): void {
    this.inner.onApplicationShutdown();
  }
}

interface Account {
  user: User;
  email: string;
}

interface Answer {
  status: number;
  errorKey: string | null;
}

runWithInfra('Request scenarios (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let refreshCookieName: string;
  let oauthDataCookieName: string;
  let userRole: Role;
  let superRole: Role;
  let permissionId: string;
  const previousKey = process.env['MFA_ENCRYPTION_KEY'];
  const stamp = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const emailPrefix = `scenario-${stamp}-`;
  let sequence = 0;
  let oauthProfile: OAuthUserProfile | undefined;
  const throttlerStorage = new PerScenarioThrottlerStorage();
  // The registry holds the names that the bootstrap sync found. A scenario
  // resource has no controller, so the runner registers it here.
  const registeredResources = new Set<string>();

  const stubGoogleGuard: CanActivate = {
    canActivate: (context: ExecutionContext): boolean => {
      if (!oauthProfile) return false;
      context.switchToHttp().getRequest<{ user: OAuthUserProfile }>().user =
        oauthProfile;
      return true;
    }
  };

  beforeAll(async () => {
    process.env['MFA_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    })
      .overrideProvider(ThrottlerStorage)
      .useValue(throttlerStorage)
      .overrideGuard(GoogleOAuthGuard)
      .useValue(stubGoogleGuard)
      .compile();

    const expressApp = moduleRef.createNestApplication<NestExpressApplication>(
      HTTP_BODY_APP_OPTIONS
    );
    applyBodyParsers(expressApp);
    app = expressApp;
    app.use(cookieParser());
    app.useGlobalPipes(new ApiValidationPipe());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);
    const secure = requiresSecureCookies(
      app.get(ConfigService).get<string>('ENVIRONMENT')
    );
    refreshCookieName = secure ? '__Host-refresh_token' : 'refresh_token';
    oauthDataCookieName = secure ? '__Host-oauth_data' : 'oauth_data';
    const roles = dataSource.getRepository(Role);
    userRole = await roles.findOneByOrFail({ name: 'user' });
    superRole = await roles.findOneByOrFail({ isSuper: true });
    // The resource sync of the bootstrap creates it, also on CI.
    permissionId = (
      await dataSource.getRepository(Permission).findOneOrFail({
        where: { resource: { name: 'roles' }, action: { name: 'read' } }
      })
    ).id;
    const registry = app.get(ResourceRegistryService);
    const isRegistered = registry.isRegistered.bind(registry);
    jest
      .spyOn(registry, 'isRegistered')
      .mockImplementation(
        (name) => registeredResources.has(name) || isRegistered(name)
      );
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
        await dataSource.getRepository(User).delete({ id: In(ids) });
      }
      await dataSource
        .getRepository(Role)
        .createQueryBuilder()
        .delete()
        .where('name LIKE :prefix', { prefix: `${emailPrefix}%` })
        .execute();
      await dataSource
        .getRepository(Resource)
        .createQueryBuilder()
        .delete()
        .where('name LIKE :prefix', { prefix: `${emailPrefix}%` })
        .execute();
    }
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  function freshEmail(): string {
    sequence += 1;
    return `${emailPrefix}${sequence}@example.com`;
  }

  function freshRoleName(): string {
    sequence += 1;
    return `${emailPrefix}role-${sequence}`;
  }

  // Each account starts as `user`: the default role, a password and a
  // verified address. The `admin` and `user` roles come from the migrations,
  // so this works on the unseeded database of CI.
  const ACTORS: Record<ActorFixture, (user: Partial<User>) => void> = {
    admin: (u) => {
      u.roles = [superRole];
    },
    user: () => undefined,
    'user-no-roles': (u) => {
      u.roles = [];
    },
    'user-mfa': (u) => {
      u.totpSecret = app.get(SecretEncryptionService).encrypt(TOTP_SECRET);
      u.totpEnabledAt = new Date();
      u.totpRecoveryCodes = [
        hashToken(normalizeOtpCode(SCENARIO_RECOVERY_CODE))
      ];
    },
    'oauth-only': (u) => {
      u.password = null;
    },
    unverified: (u) => {
      u.isEmailVerified = false;
    },
    locked: (u) => {
      u.failedLoginAttempts = MAX_FAILED_ATTEMPTS;
      u.lockedUntil = new Date(Date.now() + 3600_000);
    }
  };

  it('builds every actor fixture', () => {
    expect(Object.keys(ACTORS).sort()).toEqual([...ACTOR_FIXTURES].sort());
  });

  async function createAccount(fixture: ActorFixture): Promise<Account> {
    const email = freshEmail();
    const users = dataSource.getRepository(User);
    const { hash, version } = await hashPassword(SCENARIO_PASSWORD);
    const draft: Partial<User> = {
      email,
      name: 'Scenario Owner',
      password: hash,
      passwordHashVersion: version,
      isEmailVerified: true,
      roles: [userRole]
    };
    ACTORS[fixture](draft);
    const user = await users.save(users.create(draft));
    if (fixture === 'oauth-only') {
      await dataSource.getRepository(OAuthAccount).save({
        userId: user.id,
        provider: 'google',
        providerId: `google-${user.id}`
      });
    }
    return { user, email };
  }

  /** A session of the account, as a bearer and a refresh cookie. */
  async function signIn(account: Account) {
    const user = await app
      .get(UsersService)
      .findOne(account.user.id, SYSTEM_ABILITY);
    const { tokens } = await app.get(AuthService).login(user, {
      userAgent: `scenario-${sequence}`,
      ipAddress: null
    });
    return {
      bearer: tokens.access_token,
      cookie: `${refreshCookieName}=${tokens.refresh_token}`
    };
  }

  /** The raw token of the next mail that `method` sends. */
  async function mailedToken(
    method:
      | 'sendEmailVerification'
      | 'sendPasswordReset'
      | 'sendEmailChangeConfirmation',
    trigger: () => Promise<unknown>
  ): Promise<string> {
    const spy = jest
      .spyOn(app.get(MailService), method)
      .mockResolvedValue(undefined);
    try {
      await trigger();
      expect(spy).toHaveBeenCalledTimes(1);
      return spy.mock.calls[0][1];
    } finally {
      spy.mockRestore();
    }
  }

  function cookieOf(res: request.Response, name: string): string {
    const header = res.headers['set-cookie'] as string[] | string | undefined;
    const lines = Array.isArray(header) ? header : [header ?? ''];
    const line = lines.find((l) => l.startsWith(`${name}=`));
    if (!line) throw new Error(`the response set no ${name} cookie`);
    return line.split(';')[0];
  }

  interface Context {
    actor?: Account;
    target?: Account;
    bearer?: string;
    cookies: string[];
    values: Partial<Record<ScenarioPlaceholder, string>>;
    resourceName?: string;
  }

  const STATES: Record<StateFixture, (ctx: Context) => Promise<void>> = {
    'refresh-cookie': async (ctx) => {
      const session = await signIn(ctx.actor!);
      ctx.bearer = session.bearer;
      ctx.cookies.push(session.cookie);
    },
    'second-session': async (ctx) => {
      await signIn(ctx.actor!);
      const res = await request(http())
        .get('/api/v1/auth/sessions')
        .auth(ctx.bearer!, { type: 'bearer' })
        .expect(200);
      const other = (res.body as Array<{ id: string; current: boolean }>).find(
        (s) => !s.current
      );
      ctx.values.$otherSessionId = other!.id;
    },
    'verification-token': async (ctx) => {
      ctx.values.$verificationToken = await mailedToken(
        'sendEmailVerification',
        () => app.get(AuthService).resendVerificationEmail(ctx.actor!.email)
      );
    },
    'reset-token': async (ctx) => {
      ctx.values.$resetToken = await mailedToken('sendPasswordReset', () =>
        app.get(AuthService).forgotPassword(ctx.actor!.email)
      );
    },
    'email-change-token': async (ctx) => {
      ctx.values.$emailChangeToken = await mailedToken(
        'sendEmailChangeConfirmation',
        () =>
          app.get(AuthService).initiateEmailChange(ctx.actor!.user.id, {
            newEmail: ctx.values.$newEmail!,
            currentPassword: SCENARIO_PASSWORD
          })
      );
    },
    'mfa-setup': async (ctx) => {
      const res = await request(http())
        .post('/api/v1/auth/mfa/setup')
        .auth(ctx.bearer!, { type: 'bearer' })
        .send({ currentPassword: SCENARIO_PASSWORD })
        .expect(200);
      ctx.values.$setupCode = generateSync({
        secret: (res.body as { secret: string }).secret
      });
    },
    'mfa-challenge': async (ctx) => {
      const user = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: ctx.actor!.user.id });
      ctx.values.$mfaToken = app
        .get(MfaService)
        .issuePendingToken(user).mfaToken;
    },
    'oauth-data': async (ctx) => {
      oauthProfile = {
        provider: 'google',
        providerId: `google-${ctx.actor!.user.id}`,
        email: ctx.actor!.email,
        name: 'Scenario Owner',
        emailVerified: true
      };
      const res = await request(http())
        .get('/api/v1/auth/oauth/google/callback')
        .expect(302);
      oauthProfile = undefined;
      ctx.cookies.push(cookieOf(res, oauthDataCookieName));
    },
    'step-up-code-failures': async (ctx) => {
      const user = await dataSource
        .getRepository(User)
        .findOneByOrFail({ id: ctx.actor!.user.id });
      for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
        await app.get(MfaService).isValidStepUpCode(user, WRONG_CODE);
      }
    },
    'vk-linked': async (ctx) => {
      await dataSource.getRepository(OAuthAccount).save({
        userId: ctx.actor!.user.id,
        provider: 'vk',
        providerId: `vk-${ctx.actor!.user.id}`
      });
    },
    'custom-role': async (ctx) => {
      const role = await dataSource
        .getRepository(Role)
        .save({ name: ctx.values.$roleName!, description: null });
      ctx.values.$roleId = role.id;
    },
    'role-permission': async (ctx) => {
      await dataSource.getRepository(RolePermission).save({
        roleId: ctx.values.$roleId!,
        permissionId,
        conditions: null
      });
    },
    'target-role': async (ctx) => {
      await dataSource
        .createQueryBuilder()
        .relation(User, 'roles')
        .of(ctx.target!.user.id)
        .add(ctx.values.$roleId!);
    },
    resource: async (ctx) => {
      sequence += 1;
      const name = `${emailPrefix}resource-${sequence}`;
      const resource = await dataSource.getRepository(Resource).save({
        name,
        subject: `Scenario${stamp.replace(/\W/g, '')}R${sequence}`,
        displayName: 'Scenario resource',
        description: null,
        actionNames: ['read', 'update'],
        conditionalActionNames: [],
        allowedActionNames: null
      });
      registeredResources.add(name);
      ctx.resourceName = name;
      ctx.values.$resourceId = resource.id;
    },
    'orphaned-resource': async (ctx) => {
      await dataSource
        .getRepository(Resource)
        .update(ctx.values.$resourceId!, { isOrphaned: true });
    },
    'unregistered-resource': (ctx) => {
      registeredResources.delete(ctx.resourceName!);
      return Promise.resolve();
    }
  };

  /** The audit rows that name one of the accounts, oldest first. */
  async function auditRows(ids: string[], emails: string[]) {
    if (ids.length === 0) ids = ['00000000-0000-0000-0000-000000000000'];
    return dataSource
      .getRepository(AuditLog)
      .createQueryBuilder('a')
      .where('a.actorId IN (:...ids)', { ids })
      .orWhere('a.targetId IN (:...ids)', { ids })
      .orWhere('a.actorEmail IN (:...emails)', { emails })
      .orderBy('a.createdAt', 'ASC')
      .getMany();
  }

  async function idsOf(emails: string[]): Promise<string[]> {
    const rows = await dataSource
      .getRepository(User)
      .find({ where: { email: In(emails) }, withDeleted: true });
    return rows.map((r) => r.id);
  }

  async function newAuditActions(
    emails: string[],
    seen: Set<string>,
    expected: number
  ): Promise<string[]> {
    const read = async () => {
      const rows = await auditRows(await idsOf(emails), emails);
      return rows.filter((r) => !seen.has(r.id)).map((r) => r.action);
    };
    const deadline = Date.now() + AUDIT_WAIT_MS;
    let actions = await read();
    while (actions.length < expected && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      actions = await read();
    }
    await new Promise((r) => setTimeout(r, AUDIT_SETTLE_MS));
    return read();
  }

  /** The ids of the rows that exist once the fixture writes have landed. */
  async function settledAuditIds(emails: string[]): Promise<Set<string>> {
    let before = -1;
    let rows = await auditRows(await idsOf(emails), emails);
    while (rows.length !== before) {
      before = rows.length;
      await new Promise((r) => setTimeout(r, AUDIT_SETTLE_MS));
      rows = await auditRows(await idsOf(emails), emails);
    }
    return new Set(rows.map((r) => r.id));
  }

  async function run(scenario: RequestScenario) {
    throttlerStorage.reset();
    const ctx: Context = { cookies: [], values: {} };
    const emails: string[] = [];
    ctx.values.$password = SCENARIO_PASSWORD;
    ctx.values.$newPassword = SCENARIO_NEW_PASSWORD;
    ctx.values.$recoveryCode = SCENARIO_RECOVERY_CODE;
    ctx.values.$newEmail = freshEmail();
    ctx.values.$roleName = freshRoleName();
    ctx.values.$permissionId = permissionId;
    emails.push(ctx.values.$newEmail);

    if (scenario.actor) {
      ctx.actor = await createAccount(scenario.actor);
      ctx.values.$email = ctx.actor.email;
      emails.push(ctx.actor.email);
    }
    if (scenario.target) {
      ctx.target = await createAccount(scenario.target);
      ctx.values.$targetId = ctx.target.user.id;
      emails.push(ctx.target.email);
    }
    const states = scenario.state ?? [];
    if (scenario.auth === 'bearer' && !states.includes('refresh-cookie')) {
      ctx.bearer = (await signIn(ctx.actor!)).bearer;
    }
    for (const state of states) {
      await STATES[state](ctx);
    }
    if (ctx.actor && scenario.actor === 'user-mfa') {
      // A code is single use: the fixtures above may have spent this step.
      await dataSource
        .getRepository(User)
        .update(ctx.actor.user.id, { totpLastUsedStep: null });
      ctx.values.$code = generateSync({ secret: TOTP_SECRET });
    }

    const seen = await settledAuditIds(emails);

    const method = scenarioMethod(scenario).toLowerCase() as
      'get' | 'post' | 'put' | 'patch' | 'delete';
    const path = scenarioPath(scenario, ctx.values);
    const body = resolvePlaceholders(scenario.body ?? {}, ctx.values);
    const answers: Answer[] = [];
    for (let i = 0; i < (scenario.repeat ?? 1); i++) {
      let req = request(http())[method](path);
      if (scenario.auth === 'bearer') {
        req = req.auth(ctx.bearer!, { type: 'bearer' });
      }
      if (ctx.cookies.length > 0) req = req.set('Cookie', ctx.cookies);
      const res = await req.send(body);
      answers.push({
        status: res.status,
        errorKey: (res.body as { errorKey?: string }).errorKey ?? null
      });
    }

    const audit = await newAuditActions(
      emails,
      seen,
      scenario.expect.audit.length
    );
    return { answers, audit };
  }

  for (const { file, scenarios } of loadScenarioFiles()) {
    describe(file, () => {
      it.each(scenarios.map((s) => [s.name, s] as const))(
        '%s',
        async (_name, scenario) => {
          const { answers, audit } = await run(scenario);
          // Fire-and-forget writes land in any order.
          expect({ answers, audit: [...audit].sort() }).toEqual({
            answers: expectedAnswers(scenario),
            audit: [...scenario.expect.audit].sort()
          });
        },
        30000
      );
    });
  }
});
