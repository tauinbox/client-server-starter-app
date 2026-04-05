import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  CreateUser,
  CursorPaginatedResponse,
  PaginatedResponse,
  UpdateUser,
  User,
  UserCursorListParams,
  UserListParams,
  UserSearch
} from '../models/user.types';

export const USERS_API_V1 = '/api/v1/users';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  readonly #http = inject(HttpClient);

  getAll(params: UserListParams): Observable<PaginatedResponse<User>> {
    const httpParams = this.#buildPaginationParams(params);
    return this.#http.get<PaginatedResponse<User>>(USERS_API_V1, {
      params: httpParams
    });
  }

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
    let httpParams = this.#buildCursorPaginationParams(params);

    if (criteria.email) {
      httpParams = httpParams.set('email', criteria.email);
    }

    if (criteria.firstName) {
      httpParams = httpParams.set('firstName', criteria.firstName);
    }

    if (criteria.lastName) {
      httpParams = httpParams.set('lastName', criteria.lastName);
    }

    if (criteria.isActive !== undefined) {
      httpParams = httpParams.set('isActive', criteria.isActive.toString());
    }

    return this.#http.get<CursorPaginatedResponse<User>>(
      `${USERS_API_V1}/search/cursor`,
      { params: httpParams }
    );
  }

  search(
    criteria: UserSearch,
    params: UserListParams
  ): Observable<PaginatedResponse<User>> {
    let httpParams = this.#buildPaginationParams(params);

    if (criteria.email) {
      httpParams = httpParams.set('email', criteria.email);
    }

    if (criteria.firstName) {
      httpParams = httpParams.set('firstName', criteria.firstName);
    }

    if (criteria.lastName) {
      httpParams = httpParams.set('lastName', criteria.lastName);
    }

    if (criteria.isActive !== undefined) {
      httpParams = httpParams.set('isActive', criteria.isActive.toString());
    }

    return this.#http.get<PaginatedResponse<User>>(`${USERS_API_V1}/search`, {
      params: httpParams
    });
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

  #buildPaginationParams(params: UserListParams): HttpParams {
    return new HttpParams()
      .set('page', params.page.toString())
      .set('limit', params.limit.toString())
      .set('sortBy', params.sortBy)
      .set('sortOrder', params.sortOrder);
  }
}
