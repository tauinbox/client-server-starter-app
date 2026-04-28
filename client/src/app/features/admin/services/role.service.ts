import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  PermissionCondition,
  PermissionResponse,
  RoleAdminResponse
} from '@app/shared/types/role.types';

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

export const ROLES_API_V1 = '/api/v1/roles';

@Injectable({
  providedIn: 'root'
})
export class RoleService {
  readonly #http = inject(HttpClient);

  getAll(): Observable<RoleAdminResponse[]> {
    return this.#http.get<RoleAdminResponse[]>(ROLES_API_V1);
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

  assignPermissions(
    roleId: string,
    permissionIds: string[],
    conditions?: PermissionCondition | null
  ): Observable<void> {
    return this.#http.post<void>(`${ROLES_API_V1}/${roleId}/permissions`, {
      permissionIds,
      ...(conditions != null ? { conditions } : {})
    });
  }

  removePermission(roleId: string, permissionId: string): Observable<void> {
    return this.#http.delete<void>(
      `${ROLES_API_V1}/${roleId}/permissions/${permissionId}`
    );
  }

  assignRoleToUser(userId: string, roleId: string): Observable<void> {
    return this.#http.post<void>(`${ROLES_API_V1}/assign/${userId}`, {
      roleId
    });
  }

  removeRoleFromUser(userId: string, roleId: string): Observable<void> {
    return this.#http.delete<void>(
      `${ROLES_API_V1}/assign/${userId}/${roleId}`
    );
  }
}
