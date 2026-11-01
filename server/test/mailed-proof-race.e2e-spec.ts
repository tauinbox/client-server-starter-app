import { INestApplication, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { Server } from 'http';
import { DataSource, EntityManager } from 'typeorm';
import { ErrorKeys } from '@app/shared/constants';
import { ApiValidationPipe } from '../src/common/pipes/api-validation.pipe';
import { hashToken } from '../src/common/utils/hash-token';
import { verifyPassword } from '../src/common/utils/password-hash';
import { CoreModule } from '../src/modules/core/core.module';
import {
  applyBodyParsers,
  HTTP_BODY_APP_OPTIONS
} from '../src/modules/core/http-body.config';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { UsersService } from '../src/modules/users/services/users.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { User } from '../src/modules/users/entities/user.entity';
import { MailService } from '../src/modules/mail/mail.service';
import { withPrivateThrottlerStorage } from './private-throttler';

// A write of a mailed proof, or of a new password, keys on the state that its
// caller read. Each case holds that write until a change of the credential or
// of the address has committed, then lets it go on.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Mailed proofs and own passwords under a race (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  let mail: MailService;
  const stamp = Date.now();
  const prefix = `mailed-proof-${stamp}`;
  const password = 'Lantern-Orchard-47';
  const resetPassword = 'Copper-Harbor-93';
  const heldPassword = 'Velvet-Quarry-58';
  const hourMs = 60 * 60 * 1000;

  beforeAll(async () => {
    const moduleRef: TestingModule = await withPrivateThrottlerStorage(
      Test.createTestingModule({ imports: [CoreModule.forRoot()] })
    ).compile();

    const expressApp = moduleRef.createNestApplication<NestExpressApplication>(
      HTTP_BODY_APP_OPTIONS
    );
    applyBodyParsers(expressApp);
    app = expressApp;
    app.useGlobalPipes(new ApiValidationPipe());
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI });
    await app.init();

    dataSource = app.get(DataSource);
    authService = app.get(AuthService);
    usersService = app.get(UsersService);
    mail = app.get(MailService);
  }, 60000);

  beforeEach(() => {
    for (const method of [
      'sendPasswordReset',
      'sendEmailVerification',
      'sendEmailChangeConfirmation',
      'sendEmailChangeNotificationOld',
      'sendPasswordChangedNotification'
    ] as const) {
      jest.spyOn(mail, method).mockResolvedValue(undefined);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (dataSource) {
      await dataSource
        .createQueryBuilder()
        .delete()
        .from(User)
        .where('email LIKE :prefix', { prefix: `${prefix}%` })
        .execute();
    }
    await app?.close();
  });

  function http(): Server {
    return app.getHttpServer() as Server;
  }

  function address(label: string): string {
    return `${prefix}-${label}@example.com`;
  }

  /** Registers over HTTP, so the account holds the default role. */
  async function register(label: string): Promise<User> {
    await request(http())
      .post('/api/v1/auth/register')
      .send({ email: address(label), password, name: 'Mailed Proof' })
      .expect(201);
    return dataSource
      .getRepository(User)
      .findOneByOrFail({ email: address(label) });
  }

  function row(id: string): Promise<User> {
    return dataSource.getRepository(User).findOneByOrFail({ id });
  }

  function gate(): { wait: Promise<void>; release: () => void } {
    let release: () => void = () => undefined;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
      setTimeout(resolve, 10000).unref();
    });
    return { wait, release };
  }

  /**
   * Holds the given method of `UsersService` in front of its write until
   * `release`. `arrived` resolves when the call is held.
   */
  function holdUsersServiceCall(
    method:
      | 'setPasswordResetToken'
      | 'setEmailVerificationToken'
      | 'clearPendingEmailChange'
  ): { arrived: Promise<void>; release: () => void } {
    const { wait, release } = gate();
    let markArrived: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => {
      markArrived = resolve;
    });
    const original = UsersService.prototype[method];
    jest.spyOn(usersService, method).mockImplementation(async function (
      this: UsersService,
      ...args: unknown[]
    ) {
      markArrived();
      await wait;
      return (original as (...a: unknown[]) => Promise<never>).apply(
        usersService,
        args
      );
    });
    return { arrived, release };
  }

  /** Holds the first transaction that starts after the call until `release`. */
  function holdFirstTransaction(): {
    arrived: Promise<void>;
    release: () => void;
  } {
    const { wait, release } = gate();
    let held = false;
    let markArrived: () => void = () => undefined;
    const arrived = new Promise<void>((resolve) => {
      markArrived = resolve;
    });
    const original = EntityManager.prototype.transaction;
    jest
      .spyOn(EntityManager.prototype, 'transaction')
      .mockImplementation(async function (
        this: EntityManager,
        ...args: Parameters<EntityManager['transaction']>
      ) {
        if (!held) {
          held = true;
          markArrived();
          await wait;
        }
        return original.apply(this, args);
      });
    return { arrived, release };
  }

  async function resetThePassword(user: User): Promise<void> {
    const rawToken = `${prefix}-${user.id}-reset`;
    await dataSource.getRepository(User).update(user.id, {
      passwordResetToken: hashToken(rawToken),
      passwordResetExpiresAt: new Date(Date.now() + hourMs)
    });
    await authService.resetPassword(rawToken, resetPassword);
  }

  it('voids an email change whose step-up a password reset overtook', async () => {
    const user = await register('initiate');
    const barrier = holdFirstTransaction();

    const initiate = authService
      .initiateEmailChange(user.id, {
        newEmail: address('initiate-attacker'),
        currentPassword: password
      })
      .then(
        () => 'ok',
        (err: { response?: { errorKey?: string } }) => err.response?.errorKey
      );
    await barrier.arrived;
    await resetThePassword(user);
    barrier.release();

    expect(await initiate).toBe(ErrorKeys.AUTH.TOKEN_REVOKED);
    const after = await row(user.id);
    expect(after.pendingEmail).toBeNull();
    expect(after.pendingEmailToken).toBeNull();
    expect(mail.sendEmailChangeConfirmation).not.toHaveBeenCalled();
  }, 30000);

  it('mails no reset link to an address that an administrator moved away', async () => {
    const user = await register('forgot');
    const barrier = holdUsersServiceCall('setPasswordResetToken');

    const forgot = authService.forgotPassword(user.email);
    await barrier.arrived;
    await usersService.update(
      user.id,
      { email: address('forgot-moved') },
      { ability: SYSTEM_ABILITY }
    );
    barrier.release();
    await forgot;

    expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    expect((await row(user.id)).passwordResetToken).toBeNull();
  }, 30000);

  it('mails no verification token to an address that an administrator moved away', async () => {
    const user = await register('resend');
    jest.mocked(mail.sendEmailVerification).mockClear();
    const barrier = holdUsersServiceCall('setEmailVerificationToken');

    const resend = authService.resendVerificationEmail(user.email);
    await barrier.arrived;
    await usersService.update(
      user.id,
      { email: address('resend-moved') },
      { ability: SYSTEM_ABILITY }
    );
    barrier.release();
    await resend;

    expect(
      jest.mocked(mail.sendEmailVerification).mock.calls.map(([to]) => to)
    ).toEqual([address('resend-moved')]);
    expect((await row(user.id)).isEmailVerified).toBe(false);
  }, 30000);

  it('keeps a newer email change when an expired confirmation cleans up', async () => {
    const user = await register('expired');
    const rawToken = `${prefix}-expired-token`;
    await dataSource.getRepository(User).update(user.id, {
      pendingEmail: address('expired-old'),
      pendingEmailToken: hashToken(rawToken),
      pendingEmailExpiresAt: new Date(Date.now() - 1000)
    });
    const barrier = holdUsersServiceCall('clearPendingEmailChange');

    const confirm = authService.confirmEmailChange(rawToken).then(
      () => 'ok',
      (err: { response?: { errorKey?: string } }) => err.response?.errorKey
    );
    await barrier.arrived;
    await authService.initiateEmailChange(user.id, {
      newEmail: address('expired-fresh'),
      currentPassword: password
    });
    barrier.release();

    expect(await confirm).toBe(ErrorKeys.AUTH.PENDING_EMAIL_TOKEN_EXPIRED);
    const after = await row(user.id);
    expect(after.pendingEmail).toBe(address('expired-fresh'));
    expect(after.pendingEmailToken).not.toBeNull();
  }, 30000);

  it('refuses an own password change whose step-up a password reset overtook', async () => {
    const user = await register('patch');
    const { tokens } = await authService.login(
      await usersService.findOne(user.id, SYSTEM_ABILITY),
      { userAgent: 'mailed-proof-e2e', ipAddress: null }
    );
    const barrier = holdFirstTransaction();

    const patch = request(http())
      .patch('/api/v1/auth/profile')
      .auth(tokens.access_token, { type: 'bearer' })
      .send({ password: heldPassword, currentPassword: password })
      .then((r) => r);
    await barrier.arrived;
    await resetThePassword(user);
    barrier.release();
    const patched = await patch;

    expect(patched.status).toBe(401);
    expect((patched.body as { errorKey?: string }).errorKey).toBe(
      ErrorKeys.AUTH.TOKEN_REVOKED
    );
    const after = await row(user.id);
    const check = (candidate: string) =>
      verifyPassword(candidate, after.password!, after.passwordHashVersion);
    expect((await check(resetPassword)).valid).toBe(true);
    expect((await check(heldPassword)).valid).toBe(false);
  }, 30000);
});
