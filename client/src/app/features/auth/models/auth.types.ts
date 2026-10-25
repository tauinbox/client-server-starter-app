import type { CreateUser, User } from '@shared/models/user.types';
import type { JwtPayload } from 'jwt-decode';

export type {
  TokensResponse,
  AuthResponse,
  LoginResponse,
  MfaRequiredResponse,
  MfaSetupResponse,
  MfaRecoveryCodesResponse
} from '@app/shared/types';

export type LoginCredentials = {
  email: string;
  password: string;
};

export type RegisterRequest = CreateUser;

export type UpdateProfile = {
  name?: string;
  password?: string;
  currentPassword?: string;
  code?: string;
  locale?: string;
};

export type CustomJwtPayload = JwtPayload & {
  userId: User['id'];
  email: string;
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

/**
 * The factor a step-up route reads from the body: a password, or a code from
 * the authenticator. An account created through a provider holds no password,
 * so it sends a code or proves itself with a provider round trip.
 */
export type StepUpFactorsRequest = {
  currentPassword?: string;
  code?: string;
};

/** What a session step-up authorises: one other device, or all of them. */
export type SessionRevokeTarget =
  { scope: 'one'; sessionId: string } | { scope: 'others' };

export type LockoutErrorData = {
  message: string;
  lockedUntil: string;
  retryAfter: number;
};
