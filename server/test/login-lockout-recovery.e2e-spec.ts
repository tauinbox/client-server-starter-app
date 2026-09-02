import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { User } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/services/users.service';
import { hashToken } from '../src/common/utils/hash-token';
import { BCRYPT_SALT_ROUNDS, MAX_FAILED_ATTEMPTS } from '@app/shared/constants';

// Both recovery paths are database state transitions - only a real Postgres
// proves the row ends up as claimed.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Lockout recovery (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;

  const password = 'Password1';
  const newPassword = 'Quartz-Meadow-77';
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

  const createLockedUser = async (label: string): Promise<User> => {
    const email = `lockout-recovery-${label}-${Date.now()}@example.com`;
    emails.push(email);

    const repository = dataSource.getRepository(User);
    const user = await repository.save(
      repository.create({
        email,
        firstName: 'Lockout',
        lastName: 'Recovery',
        password: await bcrypt.hash(password, BCRYPT_SALT_ROUNDS),
        isEmailVerified: true
      })
    );

    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
      await statusOf(authService.validateUser(email, 'wrong-password'));
    }

    const locked = await repository.findOneByOrFail({ id: user.id });
    expect(locked.failedLoginAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(locked.lockedUntil).toBeInstanceOf(Date);

    return locked;
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

  it('accepts the new password right after a reset on a locked account', async () => {
    const user = await createLockedUser('reset');

    const rawToken = crypto.randomBytes(32).toString('hex');
    await usersService.setPasswordResetToken(
      user.id,
      hashToken(rawToken),
      new Date(Date.now() + 30 * 60 * 1000)
    );

    await authService.resetPassword(rawToken, newPassword);

    const afterReset = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    expect(afterReset.failedLoginAttempts).toBe(0);
    expect(afterReset.lockedUntil).toBeNull();

    await expect(
      authService.validateUser(user.email, newPassword)
    ).resolves.toMatchObject({ id: user.id });
  }, 60000);

  it('restarts the counter once the lock window has elapsed', async () => {
    const user = await createLockedUser('expiry');

    const repository = dataSource.getRepository(User);
    await repository.update(user.id, {
      lockedUntil: new Date(Date.now() - 1000)
    });

    // A wrong password after the window must cost one strike, not re-lock
    expect(
      await statusOf(authService.validateUser(user.email, 'wrong-password'))
    ).toBe(HttpStatus.UNAUTHORIZED);

    const afterExpiry = await repository.findOneByOrFail({ id: user.id });
    expect(afterExpiry.failedLoginAttempts).toBe(1);
    expect(afterExpiry.lockedUntil).toBeNull();
  }, 60000);

  it('keeps rejecting with 423 while the lock window is open', async () => {
    const user = await createLockedUser('window');

    expect(await statusOf(authService.validateUser(user.email, password))).toBe(
      HttpStatus.LOCKED
    );

    const stillLocked = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: user.id });
    expect(stillLocked.failedLoginAttempts).toBe(MAX_FAILED_ATTEMPTS);
    expect(stillLocked.lockedUntil).toBeInstanceOf(Date);
  }, 60000);
});
