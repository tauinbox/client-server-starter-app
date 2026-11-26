import type { DataSource } from 'typeorm';
import { lookupBreachedPassword } from './modules/auth/breached-password/pwned-range-lookup';
import { seedAdmin } from './seed-admin';
import { User } from './modules/users/entities/user.entity';
import { Role } from './modules/auth/entities/role.entity';
import { addUserRole } from './modules/users/utils/user-roles';

jest.mock('./modules/auth/breached-password/pwned-range-lookup', () => ({
  lookupBreachedPassword: jest.fn()
}));
jest.mock('./modules/users/utils/user-roles', () =>
  jest
    .requireActual<{
      userRolesDouble: () => object;
    }>('./modules/users/testing/user-roles.double')
    .userRolesDouble()
);

const mockedLookup = jest.mocked(lookupBreachedPassword);

/**
 * The container entrypoint (`server/docker-entrypoint.sh`) runs the boot steps
 * under `set -e`, so an error here aborts the entrypoint and the API never
 * starts. Production went down that way on 2026-09-02: a breached
 * `ADMIN_PASSWORD` called `process.exit(1)` and the container entered a restart
 * loop. These tests pin the contract that made it possible.
 */
describe('seedAdmin', () => {
  const ENV = process.env;

  let userRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let roleRepo: { findOne: jest.Mock };
  let regionalRepository: jest.Mock;
  let settingsRepository: jest.Mock;
  let sources: { regional: DataSource; settings: DataSource };
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
      save: jest.fn((row: Partial<User>) =>
        Promise.resolve({ ...row, id: 'user-new' })
      )
    };
    roleRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'role-1', name: 'admin' })
    };

    regionalRepository = jest.fn(() => userRepo);
    settingsRepository = jest.fn((entity: unknown) =>
      entity === Role ? roleRepo : undefined
    );
    const manager = {
      findOne: (_entity: unknown, options: unknown): unknown =>
        userRepo.findOne(options),
      create: (_entity: unknown, row: Partial<User>): unknown =>
        userRepo.create(row),
      save: (row: Partial<User>): unknown => userRepo.save(row)
    };

    // Partial stubs on purpose: the seeder touches only getRepository, the
    // manager and a transaction, and a full DataSource would be noise with no
    // coverage value.
    sources = {
      regional: {
        getRepository: regionalRepository,
        // @ts-expect-error - partial EntityManager stub, see the comment above
        manager,
        // @ts-expect-error - partial EntityManager stub, see the comment above
        transaction: (run: (m: typeof manager) => Promise<unknown>) =>
          run(manager)
      },
      // @ts-expect-error - partial DataSource stub, see the comment above
      settings: { getRepository: settingsRepository, manager: {} }
    };

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
    await seedAdmin(sources);

    expect(userRepo.save).toHaveBeenCalledTimes(1);
    expect(addUserRole).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-new',
      roleId: 'role-1'
    });
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('adds the admin role to an existing user that lacks it', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'user-1', roles: [] });

    await seedAdmin(sources);

    expect(addUserRole).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-1',
      roleId: 'role-1'
    });
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('warns and still creates the admin when the password is breached', async () => {
    mockedLookup.mockResolvedValue('breached');

    await seedAdmin(sources);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(userRepo.save).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('public data breach')
    );
  });

  it('warns and still creates the admin when the password contains the admin name', async () => {
    process.env['ADMIN_PASSWORD'] = 'Admin-Kettle-Sunrise-19';

    await seedAdmin(sources);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(userRepo.save).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('common password')
    );
  });

  it('never exits when the blocklist is unreachable', async () => {
    mockedLookup.mockResolvedValue('unavailable');

    await seedAdmin(sources);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(userRepo.save).toHaveBeenCalledTimes(1);
  });

  it('spends no lookup when the admin already exists', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'user-1',
      roles: [{ name: 'admin' }]
    });

    await seedAdmin(sources);

    expect(mockedLookup).not.toHaveBeenCalled();
    expect(userRepo.save).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('spends no lookup and reads nothing without ADMIN_PASSWORD', async () => {
    delete process.env['ADMIN_PASSWORD'];

    await seedAdmin(sources);

    expect(regionalRepository).not.toHaveBeenCalled();
    expect(settingsRepository).not.toHaveBeenCalled();
    expect(mockedLookup).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
