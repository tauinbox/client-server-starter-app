import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type { RbacMetadataResponse } from '@app/shared/types';

const RBAC_API = '/api/v1/rbac';

@Injectable({ providedIn: 'root' })
export class RbacMetadataService {
  readonly #http = inject(HttpClient);

  getMetadata(): Observable<RbacMetadataResponse> {
    return this.#http.get<RbacMetadataResponse>(`${RBAC_API}/metadata`);
  }
}
