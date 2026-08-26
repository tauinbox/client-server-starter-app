import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { User } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/services/users.service';
import { hashToken } from '../src/common/utils/hash-token';

// Redeeming a reset token is the same proof of mailbox control as the
// verification link, so the row must come out verified - only a real Postgres
// proves the transaction wrote it.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Password reset verifies the email (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;

  const newPassword = 'NewPassword1';
  const emails: string[] = [];

  const statusOf = async (run: Promise<unknown>): Promise<number> => {
    try {
      await run;
      return HttpStatus.OK;
    } catch (error) {
      if (error instanceof HttpException) {
        return error.getStatus();
      }
      throw error;
    }
  };

  // The shape OAuthService.loginWithOAuth creates for Facebook/VK: never
  // verified, no local password.
  const createUnverifiedUser = async (
    label: string,
    overrides: Partial<User> = {}
  ): Promise<User> => {
    const email = `reset-verifies-${label}-${Date.now()}@example.com`;
    emails.push(email);

    const repository = dataSource.getRepository(User);
    return repository.save(
      repository.create({
        email,
        firstName: 'Reset',
        lastName: 'Verifies',
        password: null,
        isEmailVerified: false,
        ...overrides
      })
    );
  };

  const issueResetToken = async (userId: string): Promise<string> => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    await usersService.setPasswordResetToken(
      userId,
      hashToken(rawToken),
      new Date(Date.now() + 30 * 60 * 1000)
    );
    return rawToken;
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

  it('lets a never-verified account log in right after a reset', async () => {
    const user = await createUnverifiedUser('login');
    const rawToken = await issueResetToken(user.id);

    await authService.resetPassword(rawToken, newPassword);

    const afterReset = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    expect(afterReset.isEmailVerified).toBe(true);

    // Pre-fix this was 403 EMAIL_NOT_VERIFIED.
    expect(
      await statusOf(authService.validateUser(user.email, newPassword))
    ).toBe(HttpStatus.OK);
  }, 60000);

  it('verifies the address on the row, never an in-flight pending one', async () => {
    const pendingEmail = `reset-verifies-pending-${Date.now()}@example.com`;
    const user = await createUnverifiedUser('pending', {
      pendingEmail,
      pendingEmailToken: hashToken(crypto.randomBytes(32).toString('hex')),
      pendingEmailExpiresAt: new Date(Date.now() + 30 * 60 * 1000)
    });
    const rawToken = await issueResetToken(user.id);

    await authService.resetPassword(rawToken, newPassword);

    const afterReset = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    expect(afterReset.email).toBe(user.email);
    expect(afterReset.isEmailVerified).toBe(true);
    expect(afterReset.pendingEmail).toBeNull();
    expect(afterReset.pendingEmailToken).toBeNull();
    expect(afterReset.pendingEmailExpiresAt).toBeNull();
  }, 60000);
});
