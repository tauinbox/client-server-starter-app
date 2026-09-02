import { faker } from '@faker-js/faker';
import type { MockUser, OAuthAccount } from './types';
import { mockId } from './utils/mock-id';

export type MockUserOptions = Partial<MockUser>;
export type OAuthAccountOptions = Partial<OAuthAccount>;

let nextId = 1000;

export function createMockUser(options: MockUserOptions = {}): MockUser {
  const id = options.id ?? mockId(`user-${nextId++}`);
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
    // `??` would turn an explicit null into the default, and null is exactly
    // what an account created through a provider holds.
    password: 'password' in options ? (options.password ?? null) : 'Password1',
    isActive: options.isActive ?? faker.datatype.boolean({ probability: 0.8 }),
    roles: options.roles ?? ['user'],
    isEmailVerified: options.isEmailVerified ?? true,
    locale: options.locale ?? 'en',
    failedLoginAttempts: options.failedLoginAttempts ?? 0,
    lockedUntil: options.lockedUntil ?? null,
    tokenRevokedAt: options.tokenRevokedAt ?? null,
    totpSecret: options.totpSecret ?? null,
    totpEnabledAt: options.totpEnabledAt ?? null,
    totpRecoveryCodes: options.totpRecoveryCodes ?? null,
    pendingEmail: options.pendingEmail ?? null,
    pendingEmailToken: options.pendingEmailToken ?? null,
    pendingEmailExpiresAt: options.pendingEmailExpiresAt ?? null,
    createdAt: options.createdAt ?? now,
    updatedAt: options.updatedAt ?? now,
    deletedAt: options.deletedAt ?? null
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
