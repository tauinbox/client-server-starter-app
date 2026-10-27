import type { HttpRequest } from '@angular/common/http';
import { AuthApiEnum } from '@features/auth/constants/auth-api.const';

/**
 * Routes that carry no session and therefore must never drive the refresh or
 * the forced logout. A 401 from any of them is a verdict on the credential of
 * the request - a wrong password, a wrong two-factor code, a missing or spent
 * OAuth handoff cookie - and not a sign that the session expired.
 */
export const AUTH_EXCLUDED_URLS = [
  AuthApiEnum.Login,
  AuthApiEnum.Register,
  AuthApiEnum.RefreshToken,
  AuthApiEnum.MfaVerify,
  AuthApiEnum.MfaRecovery,
  AuthApiEnum.OAuthExchange
] as const;

/**
 * Routes whose 401 must not drive the refresh, but which still need the bearer
 * token. A sign-out answers 401 for a session that already ended, and a refresh
 * there would sign the device in again only to sign it out.
 */
export const TOKEN_REFRESH_EXCLUDED_URLS = [AuthApiEnum.Logout] as const;

export function matchesAnyPath(
  request: HttpRequest<unknown>,
  paths: readonly string[]
): boolean {
  const urlPath = request.url.split('?')[0];
  return paths.some((path) => urlPath.endsWith(path));
}
