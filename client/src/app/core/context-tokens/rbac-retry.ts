import { HttpContextToken } from '@angular/common/http';

export const RBAC_RETRY_CONTEXT = new HttpContextToken<boolean>(() => false);
