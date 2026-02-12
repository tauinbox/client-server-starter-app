import type { HttpRequest } from '@angular/common/http';
import { AuthApiEnum } from '@features/auth/constants/auth-api.const';

const AUTH_EXCLUDED_URLS = [
  AuthApiEnum.Login,
  AuthApiEnum.Register,
  AuthApiEnum.RefreshToken
] as const;

export function isAuthExcludedUrl(request: HttpRequest<unknown>): boolean {
  const urlPath = request.url.split('?')[0];
  return AUTH_EXCLUDED_URLS.some((excludedUrl) =>
    urlPath.endsWith(excludedUrl)
  );
}
