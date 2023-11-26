import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FeatureEntityResponse } from './types/feature';

@Injectable({
  providedIn: 'root'
})
export class FeatureApiService {
  private readonly http = inject(HttpClient);

  getFeatureEntities() {
    return this.http.get<FeatureEntityResponse[]>(`/api/v1/feature/entities`);
  }
}
