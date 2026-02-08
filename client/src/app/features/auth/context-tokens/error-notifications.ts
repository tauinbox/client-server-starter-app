import { HttpContextToken } from '@angular/common/http';

export const DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN =
  new HttpContextToken<boolean>(() => false);
