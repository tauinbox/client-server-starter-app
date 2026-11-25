import type { FindOneOptions } from 'typeorm';
import type { SourceManagers } from '../../../data-sources';
import { User } from '../entities/user.entity';

/**
 * A double of `users/utils/user-roles` for the specs of services whose fake
 * regional manager returns a user with its `roles` already set. Use it as the
 * factory of `jest.mock`, through `jest.requireActual`. The real module has its
 * own spec.
 */
export function userRolesDouble() {
  return {
    attachRoles: jest.fn((_managers: SourceManagers, users: User[]) => {
      for (const user of users) user.roles ??= [];

      return Promise.resolve();
    }),
    findUserWithRoles: jest.fn(
      ({ regional }: SourceManagers, options: FindOneOptions<User>) =>
        regional.findOne(User, options)
    ),
    findUserWithRolesOrFail: jest.fn(
      ({ regional }: SourceManagers, options: FindOneOptions<User>) =>
        regional.findOneOrFail(User, options)
    ),
    addUserRole: jest.fn(() => Promise.resolve())
  };
}
