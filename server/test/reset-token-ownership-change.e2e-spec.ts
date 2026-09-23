import { HttpException, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { BreachedPasswordService } from '../src/modules/auth/breached-password/breached-password.service';
import { SYSTEM_ABILITY } from '../src/modules/auth/casl/app-ability';
import { User } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/services/users.service';
import { hashToken } from '../src/common/utils/hash-token';
import { ErrorKeys } from '@app/shared/constants';

// A reset link must die when the address it was mailed to leaves the row.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('A reset link dies with an ownership change (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;
  let breachedPasswordService: BreachedPasswordService;

  const attackerPassword = 'Amber-Signal-42';
  const ownerPassword = 'Quartz-Meadow-77';
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

  const newEmail = (label: string): string => {
    const email = `reset-owner-${label}-${Date.now()}@example.com`;
    emails.push(email);
    return email;
  };

  const createUserWithResetLink = async (
    label: string,
    overrides: Partial<User> = {}
  ): Promise<{ user: User; rawToken: string }> => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const repository = dataSource.getRepository(User);
    const user = await repository.save(
      repository.create({
        email: newEmail(label),
        firstName: 'Reset',
        lastName: 'Owner',
        isEmailVerified: true,
        passwordResetToken: hashToken(rawToken),
        passwordResetExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        ...overrides
      })
    );
    return { user, rawToken };
  };

  const reload = (id: string): Promise<User> =>
    dataSource.getRepository(User).findOneOrFail({
      where: { id },
      withDeleted: true
    });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    authService = app.get(AuthService);
    usersService = app.get(UsersService);
    breachedPasswordService = app.get(BreachedPasswordService);
  }, 60000);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (emails.length) {
      await dataSource
        ?.getRepository(User)
        .delete(emails.map((e) => ({ email: e })));
    }
    await app?.close();
  });

  it('refuses the link after the owner confirms an email change', async () => {
    const rawPendingToken = crypto.randomBytes(32).toString('hex');
    const pendingEmail = newEmail('self-new');
    const { user, rawToken } = await createUserWithResetLink('self', {
      pendingEmail,
      pendingEmailToken: hashToken(rawPendingToken),
      pendingEmailExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    });

    await authService.confirmEmailChange(rawPendingToken);

    const moved = await reload(user.id);
    expect(moved.email).toBe(pendingEmail);
    expect(moved.passwordResetToken).toBeNull();
    expect(moved.passwordResetExpiresAt).toBeNull();

    expect(
      await errorKeyOf(authService.resetPassword(rawToken, attackerPassword))
    ).toBe(ErrorKeys.AUTH.INVALID_RESET_TOKEN);
  }, 60000);

  it('refuses the link after an administrator moves the address', async () => {
    const { user, rawToken } = await createUserWithResetLink('admin');
    const recoveredEmail = newEmail('admin-new');

    await usersService.update(
      user.id,
      { email: recoveredEmail },
      SYSTEM_ABILITY
    );

    expect(
      await errorKeyOf(authService.resetPassword(rawToken, attackerPassword))
    ).toBe(ErrorKeys.AUTH.INVALID_RESET_TOKEN);

    // Pre-fix the old-address link also verified the new address.
    const after = await reload(user.id);
    expect(after.email).toBe(recoveredEmail);
    expect(after.isEmailVerified).toBe(false);
  }, 60000);

  it('refuses the link after a deactivation and a reactivation', async () => {
    const { user, rawToken } = await createUserWithResetLink('deactivate');

    await usersService.update(user.id, { isActive: false }, SYSTEM_ABILITY);
    await usersService.update(user.id, { isActive: true }, SYSTEM_ABILITY);

    expect(
      await errorKeyOf(authService.resetPassword(rawToken, attackerPassword))
    ).toBe(ErrorKeys.AUTH.INVALID_RESET_TOKEN);
  }, 60000);

  it('refuses the link after a soft delete and a restore', async () => {
    const { user, rawToken } = await createUserWithResetLink('restore');

    await usersService.remove(user.id, SYSTEM_ABILITY);
    await usersService.restore(user.id, SYSTEM_ABILITY);

    expect(
      await errorKeyOf(authService.resetPassword(rawToken, attackerPassword))
    ).toBe(ErrorKeys.AUTH.INVALID_RESET_TOKEN);
  }, 60000);

  it('keeps the password the owner set while the reset was in flight', async () => {
    const { user, rawToken } = await createUserWithResetLink('race');

    // The breach lookup runs after the token lookup and before the write, so
    // the owner's change lands exactly in the window the old write ignored.
    const original = breachedPasswordService.assertNotBreached.bind(
      breachedPasswordService
    );
    jest
      .spyOn(breachedPasswordService, 'assertNotBreached')
      .mockImplementationOnce(async (password: string) => {
        await usersService.update(
          user.id,
          { password: ownerPassword },
          SYSTEM_ABILITY
        );
        await original(password);
      });

    expect(
      await errorKeyOf(authService.resetPassword(rawToken, attackerPassword))
    ).toBe(ErrorKeys.AUTH.INVALID_RESET_TOKEN);

    const after = await dataSource
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.id = :id', { id: user.id })
      .getOneOrFail();
    expect(await bcrypt.compare(ownerPassword, after.password ?? '')).toBe(
      true
    );
  }, 60000);
});
