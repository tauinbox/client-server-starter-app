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

export const RBAC_API_V1 = '/api/v1/rbac';

@Injectable({
  providedIn: 'root'
})
export class RbacAdminService {
  readonly #http = inject(HttpClient);

  getResources(): Observable<ResourceResponse[]> {
    return this.#http.get<ResourceResponse[]>(`${RBAC_API_V1}/resources`);
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
