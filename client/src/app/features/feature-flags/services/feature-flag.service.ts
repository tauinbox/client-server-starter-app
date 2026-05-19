import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type { EvaluatedFeatureFlagsResponse } from '@app/shared/types';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';

const FEATURE_FLAGS_URL = '/api/v1/feature-flags';

@Injectable({ providedIn: 'root' })
export class FeatureFlagService {
  readonly #http = inject(HttpClient);

  getEvaluatedFlags(): Observable<EvaluatedFeatureFlagsResponse> {
    return this.#http.get<EvaluatedFeatureFlagsResponse>(FEATURE_FLAGS_URL, {
      withCredentials: true,
      context: new HttpContext().set(
        DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN,
        true
      )
    });
  }
}
