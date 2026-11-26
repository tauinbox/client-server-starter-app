import { DOCUMENT, inject } from '@angular/core';
import type {
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest
} from '@angular/common/http';
import { AuthStore } from '../store/auth.store';
import { regionApiOrigin } from '../utils/region-api-origin';

const API_PATH = '/api/';

/**
 * Sends each API call to the host of the region of the session. It runs last,
 * so the other interceptors see the relative URL: the bearer token goes only
 * to a same-origin URL, and this one moves it to a host of the code only.
 * A cross-origin call sends no cookie without `withCredentials`, so the
 * refresh cookie of the region host needs it.
 */
export const regionInterceptor: HttpInterceptorFn = (
  request: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const location = inject(DOCUMENT).defaultView?.location;
  const origin =
    location && request.url.startsWith(API_PATH)
      ? regionApiOrigin(inject(AuthStore).region(), location)
      : null;

  if (origin === null) return next(request);

  return next(
    request.clone({ url: `${origin}${request.url}`, withCredentials: true })
  );
};
