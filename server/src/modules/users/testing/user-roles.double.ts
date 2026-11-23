import type { EntityManager, FindOneOptions } from 'typeorm';
import { User } from '../entities/user.entity';

/**
 * A double of `users/utils/user-roles` for the specs of services whose fake
 * manager returns a user with its `roles` already set. Use it as the factory of
 * `jest.mock`, through `jest.requireActual`. The real module has its own spec.
 */
export function userRolesDouble() {
  return {
    attachRoles: jest.fn((_manager: EntityManager, users: User[]) => {
      for (const user of users) user.roles ??= [];

      return Promise.resolve();
    }),
    findUserWithRoles: jest.fn(
      (manager: EntityManager, options: FindOneOptions<User>) =>
        manager.findOne(User, options)
    ),
    findUserWithRolesOrFail: jest.fn(
      (manager: EntityManager, options: FindOneOptions<User>) =>
        manager.findOneOrFail(User, options)
    ),
    addUserRole: jest.fn(() => Promise.resolve())
  };
}
