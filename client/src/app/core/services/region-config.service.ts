import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { catchError, map, of } from 'rxjs';
import {
  ErrorKeys,
  regionForCountry,
  type CountryCode
} from '@app/shared/constants';
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

  /**
   * The cell that serves `country`, after a refusal of a declared country.
   * Only `errors.auth.residenceOtherRegion` names a peer; any other key gives
   * null with no request. The URL comes from the one list of peers this
   * deployment trusts, and only an https URL is given. A failed load gives
   * null: the refusal text is already on screen, and the link is an extra.
   */
  peerUrl(
    country: CountryCode,
    errorKey: string | undefined
  ): Observable<string | null> {
    if (errorKey !== ErrorKeys.AUTH.RESIDENCE_OTHER_REGION) return of(null);

    return this.get().pipe(
      map(({ peers }) => {
        const url = peers[regionForCountry(country)];

        return url && URL.parse(url)?.protocol === 'https:' ? url : null;
      }),
      catchError(() => of(null))
    );
  }
}
