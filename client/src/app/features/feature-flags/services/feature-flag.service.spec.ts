import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { FeatureFlagService } from './feature-flag.service';

describe('FeatureFlagService', () => {
  let service: FeatureFlagService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(FeatureFlagService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('GETs /api/v1/feature-flags with credentials', async () => {
    const promise = firstValueFrom(service.getEvaluatedFlags());
    const req = http.expectOne('/api/v1/feature-flags');
    expect(req.request.method).toBe('GET');
    expect(req.request.withCredentials).toBe(true);
    req.flush({
      flags: { 'new-dashboard': false, 'beta-export': true },
      evaluatedAt: '2026-05-19T10:00:00Z'
    });
    const result = await promise;
    expect(result.flags['new-dashboard']).toBe(false);
    expect(result.flags['beta-export']).toBe(true);
  });
});
