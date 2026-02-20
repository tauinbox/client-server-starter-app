import type { UserResponse } from './user.types';

export type TokensResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export type AuthResponse = {
  tokens: TokensResponse;
  user: UserResponse;
};
