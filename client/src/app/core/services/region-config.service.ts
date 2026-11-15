import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type { RegionConfigResponse } from '@app/shared/types';

export const REGION_CONFIG_API_V1 = '/api/v1/config/region';

/** The data region of this deployment and the public URLs of the others. */
@Injectable({
  providedIn: 'root'
})
export class RegionConfigService {
  readonly #http = inject(HttpClient);

  get(): Observable<RegionConfigResponse> {
    return this.#http.get<RegionConfigResponse>(REGION_CONFIG_API_V1);
  }
}
