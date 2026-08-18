import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  CursorPaginatedResponse,
  PermissionCondition,
  PermissionResponse,
  RoleAdminResponse
} from '@app/shared/types';
import {
  cursorParams,
  type CursorPageRequest
} from '@shared/utils/pagination.utils';
import { ROLES_API_V1 } from '@core/services/role-catalog.service';

export type CreateRole = {
  name: string;
  description?: string | null;
};

export type UpdateRole = {
  name?: string;
  description?: string | null;
};

export type RolePermissionItem = {
  id: string;
  roleId: string;
  permissionId: string;
  conditions: PermissionCondition | null;
  permission: PermissionResponse;
};

/**
 * Role administration. Reading the role catalog for a picker or a filter is
 * `RoleCatalogService` in core - do not add a list read back here.
 */
@Injectable({
  providedIn: 'root'
})
export class RoleService {
  readonly #http = inject(HttpClient);

  getAllCursor(
    request: CursorPageRequest
  ): Observable<CursorPaginatedResponse<RoleAdminResponse>> {
    return this.#http.get<CursorPaginatedResponse<RoleAdminResponse>>(
      `${ROLES_API_V1}/cursor`,
      { params: cursorParams(request) }
    );
  }

  getAllPermissions(): Observable<PermissionResponse[]> {
    return this.#http.get<PermissionResponse[]>(`${ROLES_API_V1}/permissions`);
  }

  getRolePermissions(roleId: string): Observable<RolePermissionItem[]> {
    return this.#http.get<RolePermissionItem[]>(
      `${ROLES_API_V1}/${roleId}/permissions`
    );
  }

  create(role: CreateRole): Observable<RoleAdminResponse> {
    return this.#http.post<RoleAdminResponse>(ROLES_API_V1, role);
  }

  update(id: string, role: UpdateRole): Observable<RoleAdminResponse> {
    return this.#http.patch<RoleAdminResponse>(`${ROLES_API_V1}/${id}`, role);
  }

  delete(id: string): Observable<void> {
    return this.#http.delete<void>(`${ROLES_API_V1}/${id}`);
  }

  setPermissions(
    roleId: string,
    items: { permissionId: string; conditions?: PermissionCondition | null }[]
  ): Observable<void> {
    return this.#http.put<void>(`${ROLES_API_V1}/${roleId}/permissions`, {
      items
    });
  }
}
