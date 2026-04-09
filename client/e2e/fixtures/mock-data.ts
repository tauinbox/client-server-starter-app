import { createMockJwt } from './jwt.utils';

export {
  createMockUser,
  createOAuthAccount
} from '../../../mock-server/src/factories';

import type { MockUser } from '../../../mock-server/src/types';
export type { MockUser };

export const defaultUser: MockUser = {
  id: '1',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  password: 'Password1',
  isActive: true,
  roles: ['user'],
  isEmailVerified: true,
  failedLoginAttempts: 0,
  lockedUntil: null,
  tokenRevokedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  deletedAt: null
};

export const defaultTokens = {
  access_token: createMockJwt(),
  expires_in: 3600
};

export const mockUsersList: MockUser[] = [
  {
    id: '1',
    email: 'admin@example.com',
    firstName: 'Admin',
    lastName: 'User',
    password: 'Password1',
    roles: ['admin'],
    isActive: true,
    isEmailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    tokenRevokedAt: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    deletedAt: null
  },
  {
    id: '2',
    email: 'john@example.com',
    firstName: 'John',
    lastName: 'Smith',
    password: 'Password1',
    roles: ['user'],
    isActive: true,
    isEmailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    tokenRevokedAt: null,
    createdAt: '2025-02-01T00:00:00.000Z',
    updatedAt: '2025-02-01T00:00:00.000Z',
    deletedAt: null
  },
  {
    id: '3',
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    password: 'Password1',
    roles: ['user'],
    isActive: false,
    isEmailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    tokenRevokedAt: null,
    createdAt: '2025-03-01T00:00:00.000Z',
    updatedAt: '2025-03-01T00:00:00.000Z',
    deletedAt: null
  }
];
