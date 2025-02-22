import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FeatureEntityResponse } from './types/feature';

const FEATURE_API_V1 = '/api/v1/feature';

@Injectable({
  providedIn: 'root'
})
export class FeatureApiService {
  private readonly http = inject(HttpClient);

  getFeatureDescription() {
    return this.http.get(`${FEATURE_API_V1}`, { responseType: 'text' });
  }

  getConfig() {
    return this.http.get<{api: string; token: string}>(`${FEATURE_API_V1}/config`);
  }

  getFeatureEntities() {
    return this.http.get<FeatureEntityResponse[]>(`${FEATURE_API_V1}/entities`);
  }
}
