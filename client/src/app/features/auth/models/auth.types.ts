import type { CreateUser, User } from '../../users/models/user.types';
import type { JwtPayload } from 'jwt-decode';

export type LoginCredentials = {
  email: string;
  password: string;
};

export type RegisterRequest = CreateUser;

export type TokensResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export type AuthResponse = {
  tokens: TokensResponse;
  user: User;
};

export type RefreshTokensRequest = {
  refresh_token: string;
};

export type CustomJwtPayload = JwtPayload & {
  userId: User['id'];
} & Pick<User, 'email' | 'isAdmin'>;
