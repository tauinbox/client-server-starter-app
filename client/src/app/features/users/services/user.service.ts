import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type {
  CreateUser,
  PaginatedResponse,
  UpdateUser,
  User,
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

    if (criteria.isAdmin !== undefined) {
      httpParams = httpParams.set('isAdmin', criteria.isAdmin.toString());
    }

    if (criteria.isActive !== undefined) {
      httpParams = httpParams.set('isActive', criteria.isActive.toString());
    }

    return this.#http.get<PaginatedResponse<User>>(`${USERS_API_V1}/search`, {
      params: httpParams
    });
  }

  #buildPaginationParams(params: UserListParams): HttpParams {
    return new HttpParams()
      .set('page', params.page.toString())
      .set('limit', params.limit.toString())
      .set('sortBy', params.sortBy)
      .set('sortOrder', params.sortOrder);
  }
}
