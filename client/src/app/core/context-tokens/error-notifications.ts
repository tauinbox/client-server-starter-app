import { HttpContext, HttpContextToken } from '@angular/common/http';

export const DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN =
  new HttpContextToken<boolean>(() => false);

/** For a request whose caller shows the refusal itself. */
export const silentContext = () =>
  new HttpContext().set(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN, true);
