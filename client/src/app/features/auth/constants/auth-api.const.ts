const AUTH_API_V1 = '/api/v1/auth';

export enum AuthApiEnum {
  Login = `${AUTH_API_V1}/login`,
  Logout = `${AUTH_API_V1}/logout`,
  Register = `${AUTH_API_V1}/register`,
  Profile = `${AUTH_API_V1}/profile`,
  RefreshToken = `${AUTH_API_V1}/refresh-token`,
  OAuthAccounts = `${AUTH_API_V1}/oauth/accounts`,
  OAuthLinkInit = `${AUTH_API_V1}/oauth/link-init`,
  VerifyEmail = `${AUTH_API_V1}/verify-email`,
  ResendVerification = `${AUTH_API_V1}/resend-verification`,
  ForgotPassword = `${AUTH_API_V1}/forgot-password`,
  ResetPassword = `${AUTH_API_V1}/reset-password`
}

export const OAUTH_URLS = {
  google: `${AUTH_API_V1}/oauth/google`,
  facebook: `${AUTH_API_V1}/oauth/facebook`,
  vk: `${AUTH_API_V1}/oauth/vk`
} as const;
