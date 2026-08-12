import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  ActionResponse,
  ResourceResponse
} from '@app/shared/types/rbac.types';

export type UpdateResource = {
  displayName?: string;
  description?: string | null;
  allowedActionNames?: string[] | null;
};

export type CreateAction = {
  name: string;
  displayName: string;
  description?: string;
};

export type UpdateAction = {
  displayName?: string;
  description?: string;
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

  /** One page of actions for the admin list page. */
  getActionsCursor(
    request: CursorPageRequest
  ): Observable<CursorPaginatedResponse<ActionResponse>> {
    return this.#http.get<CursorPaginatedResponse<ActionResponse>>(
      `${RBAC_API_V1}/actions/cursor`,
      { params: cursorParams(request) }
    );
  }

  /** The whole catalog, for the resource editor's allowed-actions picker. */
  getActions(): Observable<ActionResponse[]> {
    return this.#http.get<ActionResponse[]>(`${RBAC_API_V1}/actions`);
  }

  createAction(dto: CreateAction): Observable<ActionResponse> {
    return this.#http.post<ActionResponse>(`${RBAC_API_V1}/actions`, dto);
  }

  updateAction(id: string, dto: UpdateAction): Observable<ActionResponse> {
    return this.#http.patch<ActionResponse>(
      `${RBAC_API_V1}/actions/${id}`,
      dto
    );
  }

  deleteAction(id: string): Observable<void> {
    return this.#http.delete<void>(`${RBAC_API_V1}/actions/${id}`);
  }
}
