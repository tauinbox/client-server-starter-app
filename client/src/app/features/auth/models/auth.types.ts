import type { CreateUser, User } from '@shared/models/user.types';
import type { JwtPayload } from 'jwt-decode';

export type { TokensResponse, AuthResponse } from '@app/shared/types';

export type LoginCredentials = {
  email: string;
  password: string;
};

export type RegisterRequest = CreateUser;

export type UpdateProfile = {
  firstName?: string;
  lastName?: string;
  password?: string;
};

export type CustomJwtPayload = JwtPayload & {
  userId: User['id'];
  email: string;
  roles?: string[];
};

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
