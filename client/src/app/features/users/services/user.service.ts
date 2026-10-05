import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';
import type { Observable } from 'rxjs';
import type { UserEffectivePermissionsResponse } from '@app/shared/types';
import type {
  CreateUser,
  CursorPaginatedResponse,
  UpdateUser,
  User,
  UserCursorListParams,
  UserSearch
} from '../models/user.types';
import { listQueryParams } from '@shared/utils/pagination.utils';

export const USERS_API_V1 = '/api/v1/users';

/** The step-up of the CALLER, not of the user whose factor is reset. */
export type MfaResetRequest = {
  currentPassword?: string;
  code?: string;
};

@Injectable({
  providedIn: 'root'
})
export class UserService {
  readonly #http = inject(HttpClient);

  getById(id: string): Observable<User> {
    return this.#http.get<User>(`${USERS_API_V1}/${id}`);
  }

  create(user: CreateUser): Observable<User> {
    return this.#http.post<User>(USERS_API_V1, user);
  }

  update(id: string, user: UpdateUser): Observable<User> {
    return this.#http.patch<User>(`${USERS_API_V1}/${id}`, user);
  }

  delete(id: string): Observable<void> {
    return this.#http.delete<void>(`${USERS_API_V1}/${id}`);
  }

  restore(id: string): Observable<User> {
    return this.#http.post<User>(`${USERS_API_V1}/${id}/restore`, {});
  }

  resetMfa(id: string, request: MfaResetRequest): Observable<User> {
    // The dialog shows the refusal inline, as the owner's step-up routes do.
    return this.#http.post<User>(`${USERS_API_V1}/${id}/mfa/reset`, request, {
      context: new HttpContext().set(
        DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN,
        true
      )
    });
  }

  revokeSessions(id: string): Observable<{ message: string }> {
    // The page shows one message with its own fallback key.
    return this.#http.post<{ message: string }>(
      `${USERS_API_V1}/${id}/sessions/revoke`,
      {},
      {
        context: new HttpContext().set(
          DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN,
          true
        )
      }
    );
  }

  getPermissions(id: string): Observable<UserEffectivePermissionsResponse> {
    return this.#http.get<UserEffectivePermissionsResponse>(
      `${USERS_API_V1}/${id}/permissions`
    );
  }

  getAllCursor(
    params: UserCursorListParams
  ): Observable<CursorPaginatedResponse<User>> {
    const httpParams = this.#buildCursorPaginationParams(params);
    return this.#http.get<CursorPaginatedResponse<User>>(
      `${USERS_API_V1}/cursor`,
      { params: httpParams }
    );
  }

  searchCursor(
    criteria: UserSearch,
    params: UserCursorListParams
  ): Observable<CursorPaginatedResponse<User>> {
    const httpParams = listQueryParams(
      this.#buildCursorPaginationParams(params),
      criteria
    );

    return this.#http.get<CursorPaginatedResponse<User>>(
      `${USERS_API_V1}/search/cursor`,
      { params: httpParams }
    );
  }

  #buildCursorPaginationParams(params: UserCursorListParams): HttpParams {
    let httpParams = new HttpParams()
      .set('limit', params.limit.toString())
      .set('sortBy', params.sortBy)
      .set('sortOrder', params.sortOrder);

    if (params.cursor) {
      httpParams = httpParams.set('cursor', params.cursor);
    }

    return httpParams;
  }
}
