import type { CreateUser, User } from '@shared/models/user.types';
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

export type UpdateProfile = {
  firstName?: string;
  lastName?: string;
  password?: string;
};

export type CustomJwtPayload = JwtPayload & {
  userId: User['id'];
} & Pick<User, 'email' | 'isAdmin'>;

export type ForgotPasswordRequest = {
  email: string;
};

export type ResetPasswordRequest = {
  token: string;
  password: string;
};

export type VerifyEmailRequest = {
  token: string;
};

export type ResendVerificationRequest = {
  email: string;
};

export type LockoutErrorData = {
  message: string;
  lockedUntil: string;
  retryAfter: number;
};
