import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomBytes } from 'crypto';
import { DataSource } from 'typeorm';
import {
  ErrorKeys,
  MAX_FAILED_ATTEMPTS,
  STEP_UP_OPERATION
} from '@app/shared/constants';
import { AuditAction } from '@app/shared/enums/audit-action.enum';
import { CoreModule } from '../src/modules/core/core.module';
import { SecretEncryptionService } from '../src/common/crypto/secret-encryption.service';
import { hashPassword } from '../src/common/utils/password-hash';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { MfaService } from '../src/modules/auth/services/mfa.service';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { User } from '../src/modules/users/entities/user.entity';

// ASVS 16.3.1: every refused authentication attempt leaves a row, also the
// attempts that a per-account brake refuses before it checks the factor.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const PASSWORD = 'Harbor-Lantern-58';
const WRONG_CODE = '000000';
const ATTEMPTS = MAX_FAILED_ATTEMPTS + 2;

runWithInfra('Refused authentication attempts are audited (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let mfaService: MfaService;
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
  }, 60000);

  afterAll(async () => {
    if (previousKey === undefined) delete process.env['MFA_ENCRYPTION_KEY'];
    else process.env['MFA_ENCRYPTION_KEY'] = previousKey;
    if (emails.length) {
      await dataSource
        ?.getRepository(AuditLog)
        .delete(emails.map((actorEmail) => ({ actorEmail })));
      await dataSource
        ?.getRepository(User)
        .delete(emails.map((email) => ({ email })));
    }
    await app?.close();
  });

  async function createAccount(
    tag: string,
    { verified, enrolled }: { verified: boolean; enrolled: boolean }
  ): Promise<User> {
    const email = `refused-audit-${tag}-${stamp}@example.com`;
    emails.push(email);
    const { hash, version } = await hashPassword(PASSWORD);
    const repository = dataSource.getRepository(User);
    return repository.save(
      repository.create({
        email,
        name: 'Refused Audit',
        password: hash,
        passwordHashVersion: version,
        isEmailVerified: verified,
        totpSecret: enrolled
          ? app.get(SecretEncryptionService).encrypt(SECRET)
          : null,
        totpEnabledAt: enrolled ? new Date() : null
      })
    );
  }

  // logFireAndForget resolves on its own microtask chain, so a row can land
  // after the refusal has already reached the caller, and out of order.
  async function waitForRows(
    targetId: string,
    action: AuditAction,
    expected: number
  ): Promise<AuditLog[]> {
    const repository = dataSource.getRepository(AuditLog);
    let rows: AuditLog[] = [];
    for (let attempt = 0; attempt < 40; attempt++) {
      rows = await repository.find({ where: { targetId, action } });
      if (rows.length >= expected) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return rows;
  }

  function byAttempt(rows: AuditLog[]): unknown[] {
    const attemptOf = ({ details }: AuditLog): number =>
      (details as { attempt: number }).attempt;
    return rows
      .toSorted((a, b) => attemptOf(a) - attemptOf(b))
      .map(({ details }) => details);
  }

  async function errorKeyOf(run: Promise<unknown>): Promise<unknown> {
    try {
      await run;
      return null;
    } catch (error) {
      return (error as { response?: { errorKey?: unknown } }).response
        ?.errorKey;
    }
  }

  it('audits every refused sign-in code, also on a barred account', async () => {
    const user = await createAccount('challenge', {
      verified: true,
      enrolled: true
    });
    const { mfaToken } = mfaService.issuePendingToken(user);

    const keys: unknown[] = [];
    for (let i = 0; i < ATTEMPTS; i += 1) {
      keys.push(
        await errorKeyOf(mfaService.verifyChallenge(mfaToken, WRONG_CODE))
      );
    }

    expect(keys.at(-1)).toBe(ErrorKeys.AUTH.MFA_CHALLENGE_LOCKED);
    const rows = await waitForRows(
      user.id,
      AuditAction.MFA_CHALLENGE_FAILURE,
      ATTEMPTS
    );
    expect(byAttempt(rows)).toEqual(
      Array.from({ length: ATTEMPTS }, (_, i) => ({
        stage: 'challenge',
        attempt: i + 1
      }))
    );
  }, 30000);

  it('audits every refused step-up password, also on a barred account', async () => {
    const user = await createAccount('step-up-password', {
      verified: true,
      enrolled: false
    });

    const keys: unknown[] = [];
    for (let i = 0; i < ATTEMPTS; i += 1) {
      keys.push(
        await errorKeyOf(
          authService.assertStepUp(user, {
            operation: STEP_UP_OPERATION.PASSWORD_SET,
            currentPassword: 'Wrong-Password-11'
          })
        )
      );
    }

    expect(keys.at(-1)).toBe(ErrorKeys.AUTH.STEP_UP_LOCKED);
    const rows = await waitForRows(
      user.id,
      AuditAction.STEP_UP_FAILURE,
      ATTEMPTS
    );
    expect(rows).toHaveLength(ATTEMPTS);
  }, 30000);

  it('audits every refused step-up code, also on a barred account', async () => {
    const user = await createAccount('step-up-code', {
      verified: true,
      enrolled: true
    });

    const keys: unknown[] = [];
    for (let i = 0; i < ATTEMPTS; i += 1) {
      keys.push(
        await errorKeyOf(
          authService.assertStepUp(user, {
            operation: STEP_UP_OPERATION.MFA_DISABLE,
            totpCode: WRONG_CODE
          })
        )
      );
    }

    expect(keys.at(-1)).toBe(ErrorKeys.AUTH.MFA_STEP_UP_LOCKED);
    const stepUpRows = await waitForRows(
      user.id,
      AuditAction.STEP_UP_FAILURE,
      ATTEMPTS
    );
    expect(stepUpRows).toHaveLength(ATTEMPTS);
    const codeRows = await waitForRows(
      user.id,
      AuditAction.MFA_CHALLENGE_FAILURE,
      ATTEMPTS
    );
    expect(byAttempt(codeRows)).toEqual(
      Array.from({ length: ATTEMPTS }, (_, i) => ({
        stage: 'step_up',
        attempt: i + 1
      }))
    );
  }, 30000);

  it('audits a correct password on an unverified account', async () => {
    const user = await createAccount('unverified', {
      verified: false,
      enrolled: false
    });

    expect(
      await errorKeyOf(authService.validateUser(user.email, PASSWORD))
    ).toBe(ErrorKeys.AUTH.EMAIL_NOT_VERIFIED);
    const rows = await waitForRows(user.id, AuditAction.USER_LOGIN_FAILURE, 1);
    expect(rows.map(({ details }) => details)).toEqual([
      { reason: 'email_not_verified' }
    ]);
  }, 30000);
});
