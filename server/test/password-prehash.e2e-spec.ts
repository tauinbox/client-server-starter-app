import { HttpException, HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { CoreModule } from '../src/modules/core/core.module';
import { AuthService } from '../src/modules/auth/services/auth.service';
import { BreachedPasswordService } from '../src/modules/auth/breached-password/breached-password.service';
import { User } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/services/users.service';
import {
  PasswordHashVersion,
  verifyPassword
} from '../src/common/utils/password-hash';
import { BCRYPT_SALT_ROUNDS } from '@app/shared/constants';

// The stored format and the lazy upgrade are row state, so only a real
// Postgres proves them.
// Runs only when DB_HOST is set: CI provides Postgres, a bare local run skips.
const runWithInfra = process.env['DB_HOST'] ? describe : describe.skip;

runWithInfra('Password pre-hash (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let authService: AuthService;
  let usersService: UsersService;

  // 64 characters and 128 bytes: the old 72-byte cap refused it.
  const CYRILLIC_64 = 'Пароль1' + 'я'.repeat(57);
  // Two values that share their first 72 bytes and differ after them.
  const PREFIX_72 = 'Quartz-Meadow-7' + 'q'.repeat(57);
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

  const nextEmail = (label: string): string => {
    const email = `password-prehash-${label}-${Date.now()}@example.com`;
    emails.push(email);
    return email;
  };

  const createVerifiedUser = async (
    label: string,
    password: string
  ): Promise<User> => {
    const user = await usersService.create({
      email: nextEmail(label),
      firstName: 'Prehash',
      lastName: 'Check',
      password
    });
    await dataSource
      .getRepository(User)
      .update(user.id, { isEmailVerified: true });
    return user;
  };

  const rowOf = (id: string): Promise<User> =>
    dataSource.getRepository(User).findOneByOrFail({ id });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [CoreModule.forRoot()]
    })
      .overrideProvider(BreachedPasswordService)
      .useValue({ assertNotBreached: jest.fn() })
      .compile();

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

  it('stores a 64-character Cyrillic password in the current format and signs in with it', async () => {
    const user = await createVerifiedUser('cyrillic', CYRILLIC_64);

    const row = await rowOf(user.id);
    expect(row.passwordHashVersion).toBe(PasswordHashVersion.PREHASHED);

    await expect(
      authService.validateUser(user.email, CYRILLIC_64)
    ).resolves.toMatchObject({ id: user.id });
    expect(
      await statusOf(authService.validateUser(user.email, CYRILLIC_64 + 'я'))
    ).toBe(HttpStatus.UNAUTHORIZED);
  }, 60000);

  it('does not let a password open an account whose password shares only its first 72 bytes', async () => {
    const user = await createVerifiedUser('prefix', PREFIX_72 + 'b');

    expect(
      await statusOf(authService.validateUser(user.email, PREFIX_72 + 'c'))
    ).toBe(HttpStatus.UNAUTHORIZED);
    await expect(
      authService.validateUser(user.email, PREFIX_72 + 'b')
    ).resolves.toMatchObject({ id: user.id });
  }, 60000);

  it('signs in against a legacy row and moves it to the current format', async () => {
    const password = 'Quartz-Meadow-77';
    const repository = dataSource.getRepository(User);
    // Written the way every row was written before the pre-hash: the column
    // default marks it as a legacy row.
    const legacy = await repository.save(
      repository.create({
        email: nextEmail('legacy'),
        firstName: 'Prehash',
        lastName: 'Legacy',
        password: await bcrypt.hash(password, BCRYPT_SALT_ROUNDS),
        isEmailVerified: true
      })
    );
    expect((await rowOf(legacy.id)).passwordHashVersion).toBe(
      PasswordHashVersion.LEGACY
    );

    await expect(
      authService.validateUser(legacy.email, password)
    ).resolves.toMatchObject({ id: legacy.id });

    const upgraded = await rowOf(legacy.id);
    expect(upgraded.passwordHashVersion).toBe(PasswordHashVersion.PREHASHED);
    expect(upgraded.password).not.toBe(legacy.password);
    expect(
      (
        await verifyPassword(
          password,
          upgraded.password ?? '',
          upgraded.passwordHashVersion
        )
      ).valid
    ).toBe(true);

    // The upgraded row still signs in.
    await expect(
      authService.validateUser(legacy.email, password)
    ).resolves.toMatchObject({ id: legacy.id });
  }, 60000);

  it('leaves a legacy row as it is after a wrong password', async () => {
    const repository = dataSource.getRepository(User);
    const legacy = await repository.save(
      repository.create({
        email: nextEmail('legacy-wrong'),
        firstName: 'Prehash',
        lastName: 'Legacy',
        password: await bcrypt.hash('Quartz-Meadow-77', BCRYPT_SALT_ROUNDS),
        isEmailVerified: true
      })
    );

    expect(
      await statusOf(authService.validateUser(legacy.email, 'wrong-password'))
    ).toBe(HttpStatus.UNAUTHORIZED);

    const row = await rowOf(legacy.id);
    expect(row.passwordHashVersion).toBe(PasswordHashVersion.LEGACY);
    expect(row.password).toBe(legacy.password);
  }, 60000);
});
