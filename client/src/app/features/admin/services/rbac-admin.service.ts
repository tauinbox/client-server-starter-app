import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type { ResourceResponse } from '@app/shared/types';

export type UpdateResource = {
  displayName?: string;
  description?: string | null;
  allowedActionNames?: string[] | null;
};

import type { CursorPaginatedResponse } from '@app/shared/types';
import {
  cursorParams,
  type CursorPageRequest
} from '@shared/utils/pagination.utils';

export const RBAC_API_V1 = '/api/v1/rbac';

@Injectable({
  providedIn: 'root'
})
export class RbacAdminService {
  readonly #http = inject(HttpClient);

  /** One page of resources for the admin list page. */
  getResourcesCursor(
    request: CursorPageRequest
  ): Observable<CursorPaginatedResponse<ResourceResponse>> {
    return this.#http.get<CursorPaginatedResponse<ResourceResponse>>(
      `${RBAC_API_V1}/resources/cursor`,
      { params: cursorParams(request) }
    );
  }

  updateResource(
    id: string,
    dto: UpdateResource
  ): Observable<ResourceResponse> {
    return this.#http.patch<ResourceResponse>(
      `${RBAC_API_V1}/resources/${id}`,
      dto
    );
  }

  restoreResource(id: string): Observable<ResourceResponse> {
    return this.#http.post<ResourceResponse>(
      `${RBAC_API_V1}/resources/${id}/restore`,
      {}
    );
  }
}
