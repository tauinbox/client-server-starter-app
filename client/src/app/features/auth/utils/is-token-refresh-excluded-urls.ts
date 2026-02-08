import { AuthApiEnum } from '@features/auth/constants/auth-api.const';
import type { HttpRequest } from '@angular/common/http';

const TOKEN_REFRESH_EXCLUDED_URLS = [AuthApiEnum.Logout] as const;

export function isTokenRefreshExcludedUrl(
  request: HttpRequest<unknown>
): boolean {
  return TOKEN_REFRESH_EXCLUDED_URLS.some((excludedUrl) =>
    request.url.includes(excludedUrl)
  );
}
