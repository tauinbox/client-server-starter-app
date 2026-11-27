import { DOCUMENT, inject } from '@angular/core';
import type {
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { API_REGION_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/api-region';
import { AuthStore } from '../store/auth.store';
import { regionApiOrigin } from '../utils/region-api-origin';

const API_PATH = '/api/';

/**
 * Sends each API call to the host of its region: the region of the request
 * context, else the region of the session. It runs last, so the other
 * interceptors see the relative URL: the bearer token goes only to a
 * same-origin URL, and this one moves it to a host of the code only.
 * A cross-origin call sends no cookie without `withCredentials`, so the
 * refresh cookie of the region host needs it.
 */
export const regionInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const location = inject(DOCUMENT).defaultView?.location;

  if (!location || !request.url.startsWith(API_PATH)) return next(request);

  const sessionRegion = inject(AuthStore).region();
  const region =
    request.context.get(API_REGION_HTTP_CONTEXT_TOKEN) ?? sessionRegion;
  // The access token of one region never goes to the pool of another.
  const scoped =
    region === sessionRegion
      ? request
      : request.clone({ headers: request.headers.delete('Authorization') });
  const origin = regionApiOrigin(region, location);

  if (origin === null) return next(scoped);

  return next(
    scoped.clone({ url: `${origin}${request.url}`, withCredentials: true })
  );
};
