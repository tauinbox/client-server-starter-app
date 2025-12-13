import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CreateUser, UpdateUser, User, UserSearch } from '../models/user.types';

export const USERS_API_V1 = 'api/v1/users';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  readonly #http = inject(HttpClient);

  getAll(): Observable<User[]> {
    return this.#http.get<User[]>(USERS_API_V1);
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

  search(criteria: UserSearch): Observable<User[]> {
    let params = new HttpParams();

    if (criteria.email) {
      params = params.set('email', criteria.email);
    }

    if (criteria.firstName) {
      params = params.set('firstName', criteria.firstName);
    }

    if (criteria.lastName) {
      params = params.set('lastName', criteria.lastName);
    }

    if (criteria.isAdmin !== undefined) {
      params = params.set('isAdmin', criteria.isAdmin.toString());
    }

    if (criteria.isActive !== undefined) {
      params = params.set('isActive', criteria.isActive.toString());
    }

    return this.#http.get<User[]>(`${USERS_API_V1}/search`, { params });
  }
}
