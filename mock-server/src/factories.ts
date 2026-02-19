import { faker } from '@faker-js/faker';
import type { MockUser, OAuthAccount } from './types';

export type MockUserOptions = Partial<MockUser>;
export type OAuthAccountOptions = Partial<OAuthAccount>;

let nextId = 1000;

export function createMockUser(options: MockUserOptions = {}): MockUser {
  const id = options.id ?? String(nextId++);
  const firstName = options.firstName ?? faker.person.firstName();
  const lastName = options.lastName ?? faker.person.lastName();
  const now = faker.date.past({ years: 1 }).toISOString();

  return {
    id,
    email:
      options.email ??
      faker.internet
        .email({ firstName, lastName, provider: 'example.com' })
        .toLowerCase(),
    firstName,
    lastName,
    password: options.password ?? 'Password1',
    isActive: options.isActive ?? faker.datatype.boolean({ probability: 0.8 }),
    isAdmin: options.isAdmin ?? false,
    isEmailVerified: options.isEmailVerified ?? true,
    failedLoginAttempts: options.failedLoginAttempts ?? 0,
    lockedUntil: options.lockedUntil ?? null,
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now
  };
}

const OAUTH_PROVIDERS = ['google', 'facebook', 'vk'];

export function createOAuthAccount(
  options: OAuthAccountOptions = {}
): OAuthAccount {
  const provider =
    options.provider ?? faker.helpers.arrayElement(OAUTH_PROVIDERS);

  return {
    provider,
    providerId:
      options.providerId ?? `${provider}-${faker.string.alphanumeric(12)}`,
    createdAt: options.createdAt ?? faker.date.past({ years: 1 }).toISOString()
  };
}
