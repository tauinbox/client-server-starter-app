import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { User } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/services/users.service';

// The lockout UPDATE is a single hand-written CASE expression whose threshold
// and interval are bound parameters; only a real Postgres can prove the bound
// SQL parses and that the CASE flips at exactly the threshold.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Login lockout UPDATE (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let usersService: UsersService;
  const email = `lockout-${Date.now()}@example.com`;
  const maxAttempts = 3;
  const lockDurationMs = 15 * 60 * 1000;
  let userId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);
    usersService = app.get(UsersService);

    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email,
        firstName: 'Lockout',
        lastName: 'Probe',
        password: null
      })
    );
    userId = user.id;
  }, 60000);

  afterAll(async () => {
    await dataSource?.getRepository(User).delete({ email });
    await app?.close();
  });

  it('locks the account at exactly the bound threshold', async () => {
    const before = Date.now();

    const first = await usersService.incrementFailedAttemptsAndLockIfNeeded(
      userId,
      maxAttempts,
      lockDurationMs
    );
    expect(first).toEqual({ failedLoginAttempts: 1, lockedUntil: null });

    const second = await usersService.incrementFailedAttemptsAndLockIfNeeded(
      userId,
      maxAttempts,
      lockDurationMs
    );
    expect(second).toEqual({ failedLoginAttempts: 2, lockedUntil: null });

    const third = await usersService.incrementFailedAttemptsAndLockIfNeeded(
      userId,
      maxAttempts,
      lockDurationMs
    );
    expect(third.failedLoginAttempts).toBe(3);
    expect(third.lockedUntil).toBeInstanceOf(Date);

    const lockedUntil = third.lockedUntil as Date;
    expect(lockedUntil.getTime()).toBeGreaterThan(
      before + lockDurationMs - 60000
    );
    expect(lockedUntil.getTime()).toBeLessThan(
      Date.now() + lockDurationMs + 60000
    );

    const persisted = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    expect(persisted.failedLoginAttempts).toBe(3);
    expect(persisted.lockedUntil).toBeInstanceOf(Date);
  }, 30000);

  it('clears the counter and the lock on reset', async () => {
    await usersService.resetLoginAttempts(userId);

    const persisted = await dataSource
      .getRepository(User)
      .findOneByOrFail({ id: userId });
    expect(persisted.failedLoginAttempts).toBe(0);
    expect(persisted.lockedUntil).toBeNull();
  }, 30000);
});
