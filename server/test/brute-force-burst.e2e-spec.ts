import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import {
  MAX_FAILED_ATTEMPTS,
  STEP_UP_OPERATION,
  TOTP_PERIOD_SECONDS
} from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { CoreModule } from '../src/modules/core/core.module';
import { SecretEncryptionService } from '../src/common/crypto/secret-encryption.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { User } from '../src/modules/users/entities/user.entity';

// A checked-and-refused secret is the only thing that makes the counted audit
// call. The services are driven directly because over HTTP the per-IP
// throttles refuse most of a burst and hide the result.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const BURST = 15;
const PASSWORD = 'Harbour-Lantern-52';
const WRONG_PASSWORD = 'Wrong-Guess-Of-Mine-7';
const WRONG_CODE = '123456';

runWithInfra('Brute-force brakes under a concurrent burst (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let mfaService: MfaService;
  let auditService: AuditService;
  const previousKey = process.env['MFA_ENCRYPTION_KEY'];
  const stamp = Date.now();
  const emails: string[] = [];

  beforeAll(async () => {
    process.env['MFA_ENCRYPTION_KEY'] = randomBytes(32).toString('base64');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    authService = app.get(AuthService);
    mfaService = app.get(MfaService);
    auditService = app.get(AuditService);
  }, 60000);

  afterAll(async () => {
    if (previousKey === undefined) delete process.env['MFA_ENCRYPTION_KEY'];
    else process.env['MFA_ENCRYPTION_KEY'] = previousKey;
    for (const email of emails) {
      await dataSource?.getRepository(User).delete({ email });
    }
    await app?.close();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * An account with a password and an enrolled authenticator. The replay
   * floor sits on the last step of the live window, so every code runs the
   * whole check - row lock, decryption, verification - and is refused. The
   * library rejects a floor further ahead than that.
   */
  async function createAccount(tag: string): Promise<User> {
    const email = `burst-${tag}-${stamp}@example.com`;
    emails.push(email);
    const repository = dataSource.getRepository(User);
    return repository.save(
      repository.create({
        email,
        firstName: 'Burst',
        lastName: 'Probe',
        password: await bcrypt.hash(PASSWORD, 4),
        isEmailVerified: true,
        totpSecret: app
          .get(SecretEncryptionService)
          .encrypt('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'),
        totpEnabledAt: new Date(),
        totpLastUsedStep:
          Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS) + 1
      })
    );
  }

  async function burst(attempt: () => Promise<unknown>): Promise<void> {
    const results = await Promise.allSettled(
      Array.from({ length: BURST }, attempt)
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(0);
  }

  it('checks at most the budget of passwords on login', async () => {
    const user = await createAccount('login');
    const audit = jest.spyOn(auditService, 'logFireAndForget');

    await burst(() => authService.validateUser(user.email, WRONG_PASSWORD));

    const checked = audit.mock.calls.filter(
      ([entry]) =>
        entry.action === AuditAction.USER_LOGIN_FAILURE &&
        entry.actorEmail === user.email &&
        ['invalid_credentials', 'account_locked_after_max_attempts'].includes(
          String(entry.details?.['reason'])
        )
    );
    expect(checked).toHaveLength(MAX_FAILED_ATTEMPTS);

    const row = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    expect(row.lockedUntil).toBeInstanceOf(Date);
  }, 60000);

  it('checks at most the budget of codes on the sign-in challenge', async () => {
    const user = await createAccount('challenge');
    const { mfaToken } = mfaService.issuePendingToken(user);
    const audit = jest.spyOn(auditService, 'log');

    await burst(() => mfaService.verifyChallenge(mfaToken, WRONG_CODE));

    expect(countCodeFailures(audit, user.id, 'challenge')).toBe(
      MAX_FAILED_ATTEMPTS
    );
  }, 60000);

  it('checks at most the budget of codes on a step-up', async () => {
    const user = await createAccount('step-up-code');
    const audit = jest.spyOn(auditService, 'log');

    await burst(async () => {
      if (!(await mfaService.isValidStepUpCode(user, WRONG_CODE))) {
        throw new Error('refused');
      }
    });

    expect(countCodeFailures(audit, user.id, 'step_up')).toBe(
      MAX_FAILED_ATTEMPTS
    );
  }, 60000);

  it('checks at most the budget of passwords on a step-up', async () => {
    const user = await createAccount('step-up-password');
    const audit = jest.spyOn(auditService, 'logFireAndForget');

    await burst(() =>
      authService.assertStepUp(
        user,
        WRONG_PASSWORD,
        undefined,
        STEP_UP_OPERATION.PASSWORD_SET
      )
    );

    const checked = audit.mock.calls.filter(
      ([entry]) =>
        entry.action === AuditAction.STEP_UP_FAILURE &&
        entry.targetId === user.id
    );
    expect(checked).toHaveLength(MAX_FAILED_ATTEMPTS);
  }, 60000);

  function countCodeFailures(
    audit: jest.SpiedFunction<AuditService['log']>,
    userId: string,
    stage: string
  ): number {
    return audit.mock.calls.filter(
      ([entry]) =>
        entry.action === AuditAction.MFA_CHALLENGE_FAILURE &&
        entry.targetId === userId &&
        entry.details?.['stage'] === stage
    ).length;
  }
});
