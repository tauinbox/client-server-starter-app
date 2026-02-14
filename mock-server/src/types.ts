export interface MockUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export type UserResponse = Omit<MockUser, 'password'>;

export interface OAuthAccount {
  provider: string;
  providerId: string;
  createdAt: string;
}

export interface State {
  users: Map<string, MockUser>;
  oauthAccounts: Map<string, OAuthAccount[]>;
  refreshTokens: Map<string, string>;
}

import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  user: MockUser;
}

export interface TokensResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface AuthResponse {
  tokens: TokensResponse;
  user: UserResponse;
}
