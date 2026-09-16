import { HttpException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { User } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/services/users.service';
import { hashToken } from '../src/common/utils/hash-token';
import { ErrorKeys } from '@app/shared/constants';

// A password change must void every mailed proof of ownership, the same rule
// resetPassword obeys. Only a real Postgres proves the single save wrote the
// nulls, because the fix rides in the object the merge builds.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('A password change voids the mailed proofs (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;

  const newPassword = 'Quartz-Meadow-77';
  const emails: string[] = [];

  const errorKeyOf = async (run: Promise<unknown>): Promise<string> => {
    try {
      await run;
      return 'RESOLVED';
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse() as { errorKey?: string };
        return body.errorKey ?? `STATUS_${error.getStatus()}`;
      }
      throw error;
    }
  };

  const createUser = async (
    label: string,
    overrides: Partial<User> = {}
  ): Promise<User> => {
    const email = `voids-proofs-${label}-${Date.now()}@example.com`;
    emails.push(email);

    const repository = dataSource.getRepository(User);
    return repository.save(
      repository.create({
        email,
        firstName: 'Voids',
        lastName: 'Proofs',
        isEmailVerified: true,
        ...overrides
      })
    );
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    authService = app.get(AuthService);
    usersService = app.get(UsersService);
  }, 60000);

  afterAll(async () => {
    if (emails.length) {
      await dataSource
        ?.getRepository(User)
        .delete(emails.map((e) => ({ email: e })));
    }
    await app?.close();
  });

  it('refuses a reset token mailed before the password change', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const user = await createUser('reset', {
      passwordResetToken: hashToken(rawToken),
      passwordResetExpiresAt: new Date(Date.now() + 30 * 60 * 1000)
    });

    await usersService.update(
      user.id,
      { password: newPassword },
      SYSTEM_ABILITY
    );

    const afterChange = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    expect(afterChange.passwordResetToken).toBeNull();
    expect(afterChange.passwordResetExpiresAt).toBeNull();

    // Pre-fix the kept link still took the account.
    expect(
      await errorKeyOf(authService.resetPassword(rawToken, 'Amber-Signal-42'))
    ).toBe(ErrorKeys.AUTH.INVALID_RESET_TOKEN);
  }, 60000);

  it('drops an email change in flight when the password changes', async () => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const pendingEmail = `voids-proofs-pending-${Date.now()}@example.com`;
    emails.push(pendingEmail);
    const user = await createUser('pending', {
      pendingEmail,
      pendingEmailToken: hashToken(rawToken),
      pendingEmailExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    await usersService.update(
      user.id,
      { password: newPassword },
      SYSTEM_ABILITY
    );

    const afterChange = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    expect(afterChange.pendingEmail).toBeNull();
    expect(afterChange.pendingEmailToken).toBeNull();
    expect(afterChange.pendingEmailExpiresAt).toBeNull();

    // Pre-fix the confirmation link moved the address to the attacker.
    expect(await errorKeyOf(authService.confirmEmailChange(rawToken))).toBe(
      ErrorKeys.AUTH.PENDING_EMAIL_TOKEN_EXPIRED
    );
    expect(afterChange.email).toBe(user.email);
  }, 60000);

  it('leaves the mailed proofs alone when no password is submitted', async () => {
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const rawPendingToken = crypto.randomBytes(32).toString('hex');
    const pendingEmail = `voids-proofs-kept-${Date.now()}@example.com`;
    emails.push(pendingEmail);
    const user = await createUser('kept', {
      passwordResetToken: hashToken(rawResetToken),
      passwordResetExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
      pendingEmail,
      pendingEmailToken: hashToken(rawPendingToken),
      pendingEmailExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    await usersService.update(
      user.id,
      { firstName: 'Renamed' },
      SYSTEM_ABILITY
    );

    const afterChange = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    expect(afterChange.firstName).toBe('Renamed');
    expect(afterChange.passwordResetToken).not.toBeNull();
    expect(afterChange.pendingEmailToken).not.toBeNull();
    expect(
      await errorKeyOf(authService.resetPassword(rawResetToken, newPassword))
    ).toBe('RESOLVED');
  }, 60000);
});
