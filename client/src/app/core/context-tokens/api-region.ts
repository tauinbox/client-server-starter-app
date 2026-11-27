import { HttpContextToken } from '@angular/common/http';
import type { DataRegion } from '@app/shared/constants';

/**
 * The region whose API serves a request, when it is not the region of the
 * session: a mailed link names the region of the pool that holds its token.
 */
export const API_REGION_HTTP_CONTEXT_TOKEN =
  new HttpContextToken<DataRegion | null>(() => null);
