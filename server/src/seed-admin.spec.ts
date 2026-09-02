import { DataSource } from 'typeorm';
import { lookupBreachedPassword } from './modules/auth/breached-password/pwned-range-lookup';
import { seedAdmin } from './seed-admin';
import { User } from './modules/users/entities/user.entity';

jest.mock('typeorm', () => {
  const actual = jest.requireActual<typeof import('typeorm')>('typeorm');
  return { ...actual, DataSource: jest.fn() };
});
jest.mock('./postgres.config', () => ({ postgresConfig: () => ({}) }));
jest.mock('./modules/auth/breached-password/pwned-range-lookup', () => ({
  lookupBreachedPassword: jest.fn()
}));

const mockedDataSource = jest.mocked(DataSource);
const mockedLookup = jest.mocked(lookupBreachedPassword);

/**
 * The container entrypoint (`server/docker-entrypoint.sh`) runs
 * `node dist/server/src/seed-admin.js` under `set -e`, so a non-zero exit here
 * aborts the entrypoint and the API never starts. Production went down that way
 * on 2026-09-02: a breached `ADMIN_PASSWORD` called `process.exit(1)` and the
 * container entered a restart loop. These tests pin the contract that made it
 * possible.
 */
describe('seedAdmin', () => {
  const ENV = process.env;

  let userRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let roleRepo: { findOne: jest.Mock };
  let exitSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...ENV,
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD: 'Password1'
    };

    userRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((row: Partial<User>) => row),
      save: jest.fn().mockResolvedValue(undefined)
    };
    roleRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'role-1', name: 'admin' })
    };

    // A partial stub on purpose: the seeder touches exactly these three members,
    // and a full DataSource would be noise with no coverage value.
    mockedDataSource.mockImplementation(
      // @ts-expect-error - partial DataSource stub, see the comment above
      () => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn().mockResolvedValue(undefined),
        getRepository: (entity: unknown) =>
          entity === User ? userRepo : roleRepo
      })
    );

    mockedLookup.mockResolvedValue('clean');

    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    process.env = ENV;
    jest.restoreAllMocks();
  });

  it('creates the admin and never exits when the password is clean', async () => {
    await seedAdmin();

    expect(userRepo.save).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('warns and still creates the admin when the password is breached', async () => {
    mockedLookup.mockResolvedValue('breached');

    await seedAdmin();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(userRepo.save).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('public data breach')
    );
  });

  it('never exits when the blocklist is unreachable', async () => {
    mockedLookup.mockResolvedValue('unavailable');

    await seedAdmin();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(userRepo.save).toHaveBeenCalledTimes(1);
  });

  it('spends no lookup when the admin already exists', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      roles: [{ name: 'admin' }]
    });

    await seedAdmin();

    expect(mockedLookup).not.toHaveBeenCalled();
    expect(userRepo.save).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('spends no lookup and opens no connection without ADMIN_PASSWORD', async () => {
    delete process.env['ADMIN_PASSWORD'];

    await seedAdmin();

    expect(mockedDataSource).not.toHaveBeenCalled();
    expect(mockedLookup).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
