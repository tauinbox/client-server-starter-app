import type { HttpRequest } from '@angular/common/http';
import { AuthApiEnum } from '@features/auth/constants/auth-api.const';

/**
 * Routes that carry no session and therefore must never drive the refresh or
 * the forced logout. A 401 from any of them is a verdict on the credential in
 * the request body - a wrong password, a wrong two-factor code - and not a sign
 * that the session expired.
 */
export const AUTH_EXCLUDED_URLS = [
  AuthApiEnum.Login,
  AuthApiEnum.Register,
  AuthApiEnum.RefreshToken,
  AuthApiEnum.MfaVerify,
  AuthApiEnum.MfaRecovery
] as const;

/**
 * Routes whose 401 must not drive the refresh, but which still need the bearer
 * token. `MfaEnable` answers a wrong enrolment code with 401, which is a
 * verdict on the body and not on the session; a refresh there replays the same
 * wrong code, spends a second attempt of the account budget and rotates the
 * refresh cookie for nothing. It cannot go into `AUTH_EXCLUDED_URLS`, because
 * that list also suppresses the Authorization header the route requires.
 */
export const TOKEN_REFRESH_EXCLUDED_URLS = [
  AuthApiEnum.Logout,
  AuthApiEnum.MfaEnable
] as const;

export function matchesAnyPath(
  request: HttpRequest<unknown>,
  paths: readonly string[]
): boolean {
  const urlPath = request.url.split('?')[0];
  return paths.some((path) => urlPath.endsWith(path));
}
