import type { UserResponse } from './user.types';

export type TokensResponse = {
  access_token: string;
  expires_in: number;
};

export type AuthResponse = {
  tokens: TokensResponse;
  user: UserResponse;
};

/**
 * What a correct password buys on an account that carries a second factor: not
 * a session, only the right to present the second factor. The token inside
 * carries the `mfa_pending` purpose, so the bearer strategy refuses it.
 */
export type MfaRequiredResponse = {
  mfaRequired: true;
  mfaToken: string;
  expiresIn: number;
};

export type LoginResponse = AuthResponse | MfaRequiredResponse;

/** What an enrolment hands the client. The secret is shown once. */
export type MfaSetupResponse = {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
};

/** Recovery codes are readable exactly once, when the factor is turned on. */
export type MfaRecoveryCodesResponse = {
  recoveryCodes: string[];
};

/**
 * One signed-in device of the caller. `id` is the session id, which survives
 * token rotation. `userAgent` is the header the device sent when it signed in,
 * or null for a session that started before the server recorded it.
 */
export type ActiveSessionResponse = {
  id: string;
  current: boolean;
  userAgent: string | null;
  startedAt: string;
  lastActiveAt: string;
};

export type CaptchaProvider = 'turnstile';

export type CaptchaConfigResponse = {
  enabled: boolean;
  provider: CaptchaProvider;
  siteKey: string | null;
};
