import type { HttpRequest } from '@angular/common/http';
import { AuthApiEnum } from '@features/auth/constants/auth-api.const';

/**
 * Routes that carry no session and therefore must never drive the refresh or
 * the forced logout. A 401 from any of them is a verdict on the credential in
 * the request body - a wrong password, a wrong two-factor code - and not a sign
 * that the session expired.
 */
const AUTH_EXCLUDED_URLS = [
  AuthApiEnum.Login,
  AuthApiEnum.Register,
  AuthApiEnum.RefreshToken,
  AuthApiEnum.MfaVerify,
  AuthApiEnum.MfaRecovery
] as const;

export function isAuthExcludedUrl(request: HttpRequest<unknown>): boolean {
  const urlPath = request.url.split('?')[0];
  return AUTH_EXCLUDED_URLS.some((excludedUrl) =>
    urlPath.endsWith(excludedUrl)
  );
}
