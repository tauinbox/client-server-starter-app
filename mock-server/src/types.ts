import type { Request } from 'express';

export type {
  UserResponse,
  OAuthAccountResponse,
  TokensResponse,
  AuthResponse
} from '@app/shared/types';

export interface MockUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  isActive: boolean;
  isAdmin: boolean;
  roles: string[];
  isEmailVerified: boolean;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OAuthAccount {
  provider: string;
  providerId: string;
  createdAt: string;
}

export interface State {
  users: Map<string, MockUser>;
  oauthAccounts: Map<string, OAuthAccount[]>;
  refreshTokens: Map<string, string>;
  emailVerificationTokens: Map<string, string>; // token -> userId
  passwordResetTokens: Map<string, string>; // token -> userId
}

export interface AuthenticatedRequest extends Request {
  user: MockUser;
}
