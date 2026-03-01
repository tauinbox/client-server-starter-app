import { createMockJwt } from './jwt.utils';
import type { UserResponse } from '@app/shared/types';

export {
  createMockUser,
  createOAuthAccount
} from '../../../mock-server/src/factories';

export type MockUser = UserResponse;

export const defaultUser: MockUser = {
  id: '1',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  isActive: true,
  roles: ['user'],
  isEmailVerified: true,
  failedLoginAttempts: 0,
  lockedUntil: null,
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
    roles: ['admin'],
    isActive: true,
    isEmailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    deletedAt: null
  },
  {
    id: '2',
    email: 'john@example.com',
    firstName: 'John',
    lastName: 'Smith',
    roles: ['user'],
    isActive: true,
    isEmailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: '2025-02-01T00:00:00.000Z',
    updatedAt: '2025-02-01T00:00:00.000Z',
    deletedAt: null
  },
  {
    id: '3',
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    roles: ['user'],
    isActive: false,
    isEmailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: '2025-03-01T00:00:00.000Z',
    updatedAt: '2025-03-01T00:00:00.000Z',
    deletedAt: null
  }
];
