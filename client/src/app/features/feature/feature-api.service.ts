import { inject, Injectable } from '@angular/core';
import {
  HttpClient,
  HttpEvent,
  HttpEventType,
  HttpResponse
} from '@angular/common/http';
import { FeatureEntityResponse } from './models/feature.types';
import { Observable } from 'rxjs';

const FEATURE_API_V1 = '/api/v1/feature';

@Injectable({
  providedIn: 'root'
})
export class FeatureApiService {
  readonly #http = inject(HttpClient);

  getFeatureDescription() {
    return this.#http.get(`${FEATURE_API_V1}`, { responseType: 'text' });
  }

  getConfig() {
    return this.#http.get<{ api: string; token: string }>(`${FEATURE_API_V1}/config`);
  }

  getFeatureEntities() {
    return this.#http.get<FeatureEntityResponse[]>(`${FEATURE_API_V1}/entities`);
  }

  uploadFile(file: File): Observable<HttpEvent<HttpEventType> | HttpResponse<void>> {
    const formData = new FormData();
    formData.append('upload-artifact', file);

    return this.#http.post<void>(`${FEATURE_API_V1}/upload`, formData, {
      reportProgress: true,
      observe: 'events'
    });
  }
}
