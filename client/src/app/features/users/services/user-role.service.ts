import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { silentContext } from '@core/context-tokens/error-notifications';
import { ROLES_API_V1 } from '@core/services/role-catalog.service';

/**
 * Role membership of a single user, as edited from the user screens. The routes
 * hang off the roles API, but the operation belongs to the user being edited.
 * The edit form shows a refusal itself, so the requests are silent.
 */
@Injectable({
  providedIn: 'root'
})
export class UserRoleService {
  readonly #http = inject(HttpClient);

  assignRole(userId: string, roleId: string): Observable<void> {
    return this.#http.post<void>(
      `${ROLES_API_V1}/assign/${userId}`,
      { roleId },
      { context: silentContext() }
    );
  }

  removeRole(userId: string, roleId: string): Observable<void> {
    return this.#http.delete<void>(
      `${ROLES_API_V1}/assign/${userId}/${roleId}`,
      { context: silentContext() }
    );
  }
}
