import type { HttpRequest } from '@angular/common/http';
import { AuthApiEnum } from '@features/auth/constants/auth-api.const';

const AUTH_EXCLUDED_URLS = [
  AuthApiEnum.Login,
  AuthApiEnum.Register,
  AuthApiEnum.RefreshToken
] as const;

export function isAuthExcludedUrl(request: HttpRequest<unknown>): boolean {
  return AUTH_EXCLUDED_URLS.some((excludedUrl) =>
    request.url.includes(excludedUrl)
  );
}
