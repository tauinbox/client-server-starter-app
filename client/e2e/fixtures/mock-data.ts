import { createMockJwt } from './jwt.utils';

export {
  createMockUser,
  createOAuthAccount
} from '../../../mock-server/src/factories';

export type MockUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

export const defaultUser: MockUser = {
  id: '1',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  isActive: true,
  isAdmin: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z'
};

export const defaultTokens = {
  access_token: createMockJwt(),
  refresh_token: createMockJwt(),
  expires_in: 3600
};

export const mockUsersList: MockUser[] = [
  {
    id: '1',
    email: 'admin@example.com',
    firstName: 'Admin',
    lastName: 'User',
    isAdmin: true,
    isActive: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z'
  },
  {
    id: '2',
    email: 'john@example.com',
    firstName: 'John',
    lastName: 'Smith',
    isAdmin: false,
    isActive: true,
    createdAt: '2025-02-01T00:00:00.000Z',
    updatedAt: '2025-02-01T00:00:00.000Z'
  },
  {
    id: '3',
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    isAdmin: false,
    isActive: false,
    createdAt: '2025-03-01T00:00:00.000Z',
    updatedAt: '2025-03-01T00:00:00.000Z'
  }
];
