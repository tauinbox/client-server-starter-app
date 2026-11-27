import type { DataRegion } from '@app/shared/constants';
import {
  regionApiOrigin,
  type RegionLocation
} from '../utils/region-api-origin';

const AUTH_API_V1 = '/api/v1/auth';

export enum AuthApiEnum {
  Login = `${AUTH_API_V1}/login`,
  Logout = `${AUTH_API_V1}/logout`,
  Register = `${AUTH_API_V1}/register`,
  Profile = `${AUTH_API_V1}/profile`,
  RefreshToken = `${AUTH_API_V1}/refresh-token`,
  OAuthAccounts = `${AUTH_API_V1}/oauth/accounts`,
  OAuthLinkInit = `${AUTH_API_V1}/oauth/link-init`,
  OAuthReauthInit = `${AUTH_API_V1}/oauth/reauth-init`,
  OAuthExchange = `${AUTH_API_V1}/oauth/exchange`,
  OAuthSignup = `${AUTH_API_V1}/oauth/signup`,
  VerifyEmail = `${AUTH_API_V1}/verify-email`,
  ResendVerification = `${AUTH_API_V1}/resend-verification`,
  ForgotPassword = `${AUTH_API_V1}/forgot-password`,
  ResetPassword = `${AUTH_API_V1}/reset-password`,
  Permissions = `${AUTH_API_V1}/permissions`,
  CaptchaConfig = `${AUTH_API_V1}/captcha-config`,
  InitiateEmailChange = `${AUTH_API_V1}/profile/email/initiate`,
  ConfirmEmailChange = `${AUTH_API_V1}/profile/email/confirm`,
  Residence = `${AUTH_API_V1}/profile/residence`,
  MfaSetup = `${AUTH_API_V1}/mfa/setup`,
  MfaEnable = `${AUTH_API_V1}/mfa/enable`,
  MfaDisable = `${AUTH_API_V1}/mfa/disable`,
  MfaVerify = `${AUTH_API_V1}/mfa/verify`,
  MfaRecovery = `${AUTH_API_V1}/mfa/recovery`,
  MfaRecoveryCodes = `${AUTH_API_V1}/mfa/recovery-codes`,
  Sessions = `${AUTH_API_V1}/sessions`
}

// Not exported: the start is a top-level navigation that no HTTP interceptor
// sees, so a relative path would go to the origin of the SPA and miss the
// intent cookie that the API host of the region set. `oauthStartUrl` is the
// only way to get a start URL.
const OAUTH_PATHS = {
  google: `${AUTH_API_V1}/oauth/google`,
  facebook: `${AUTH_API_V1}/oauth/facebook`,
  vk: `${AUTH_API_V1}/oauth/vk`
} as const;

export type OAuthProvider = keyof typeof OAUTH_PATHS;

/** The start URL of `provider` on the API host of `region`. */
export function oauthStartUrl(
  provider: OAuthProvider,
  { region, location }: { region: DataRegion; location: RegionLocation }
): string {
  return `${regionApiOrigin(region, location) ?? ''}${OAUTH_PATHS[provider]}`;
}

/** Keyed by OAuthProvider so a new entry in OAUTH_PATHS fails the build until it gets a label. */
export const OAUTH_PROVIDER_LABEL_KEYS: Record<OAuthProvider, string> = {
  google: 'auth.providers.google',
  facebook: 'auth.providers.facebook',
  vk: 'auth.providers.vk'
};

/**
 * Providers arrive as plain strings (feature flags, route params), and an
 * unknown one would index OAUTH_PATHS to `undefined` and navigate the window
 * to the literal "undefined". Own-property check only - `in` would accept
 * inherited keys such as "constructor".
 */
export function isOAuthProvider(value: string): value is OAuthProvider {
  return Object.hasOwn(OAUTH_PATHS, value);
}
