import { AuthApiEnum } from '@features/auth/constants/auth-api.const';
import type { HttpRequest } from '@angular/common/http';

/**
 * Routes whose 401 must not drive the refresh, but which still need the bearer
 * token. `MfaEnable` answers a wrong enrolment code with 401, which is a
 * verdict on the body and not on the session; a refresh there replays the same
 * wrong code, spends a second attempt of the account budget and rotates the
 * refresh cookie for nothing. It cannot go into `AUTH_EXCLUDED_URLS`, because
 * that list also suppresses the Authorization header the route requires.
 */
const TOKEN_REFRESH_EXCLUDED_URLS = [
  AuthApiEnum.Logout,
  AuthApiEnum.MfaEnable
] as const;

export function isTokenRefreshExcludedUrl(
  request: HttpRequest<unknown>
): boolean {
  const urlPath = request.url.split('?')[0];
  return TOKEN_REFRESH_EXCLUDED_URLS.some((excludedUrl) =>
    urlPath.endsWith(excludedUrl)
  );
}
