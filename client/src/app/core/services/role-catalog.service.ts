import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type { RoleAdminResponse } from '@app/shared/types';

export const ROLES_API_V1 = '/api/v1/roles';

/**
 * The role catalog is a reference load - every consumer needs the whole list in
 * one response to populate a picker or a filter, so it is deliberately not
 * cursor paginated. It lives in core because it is read from several features;
 * role administration itself stays in `features/admin`.
 */
@Injectable({
  providedIn: 'root'
})
export class RoleCatalogService {
  readonly #http = inject(HttpClient);

  getAll(): Observable<RoleAdminResponse[]> {
    return this.#http.get<RoleAdminResponse[]>(ROLES_API_V1);
  }
}
