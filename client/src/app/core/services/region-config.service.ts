import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { catchError, map, of } from 'rxjs';
import {
  DATA_REGIONS,
  ErrorKeys,
  HOME_DATA_REGION,
  regionForCountry,
  type CountryCode,
  type DataRegion
} from '@app/shared/constants';
import type { RegionConfigResponse } from '@app/shared/types';

export const REGION_CONFIG_API_V1 = '/api/v1/config/region';

/** The public URL of another cell. */
export type PeerLink = { region: DataRegion; url: string };

// The client makes a link only of an https URL, also when the list comes
// from this deployment.
function httpsUrl(url: string | undefined): string | null {
  return url && URL.parse(url)?.protocol === 'https:' ? url : null;
}

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
   * The region whose pool creates the account of a resident of `country`:
   * the region of the country while the registry lists it as public, else
   * the home region. A country of the home region needs no request. A failed
   * load gives the home region, which refuses a country of another region
   * with its own key.
   */
  registrationRegion(country: CountryCode): Observable<DataRegion> {
    const region = regionForCountry(country);

    if (region === HOME_DATA_REGION) return of(HOME_DATA_REGION);

    return this.get().pipe(
      map(({ publicRegions }) =>
        publicRegions.includes(region) ? region : HOME_DATA_REGION
      ),
      catchError(() => of(HOME_DATA_REGION))
    );
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
      map(({ peers }) => httpsUrl(peers[regionForCountry(country)])),
      catchError(() => of(null))
    );
  }

  /**
   * Every other cell, in the order of `DATA_REGIONS`, for the static links of
   * the sign-in page. Sign-in never asks another cell whether it holds an
   * email. A failed load gives no links: the links are an extra.
   */
  peerLinks(): Observable<PeerLink[]> {
    return this.get().pipe(
      map(({ peers }) =>
        DATA_REGIONS.flatMap((region) => {
          const url = httpsUrl(peers[region]);

          return url ? [{ region, url }] : [];
        })
      ),
      catchError(() => of([]))
    );
  }
}
