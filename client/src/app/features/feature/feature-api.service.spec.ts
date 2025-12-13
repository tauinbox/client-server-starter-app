import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { FeatureApiService } from './feature-api.service';

describe('FeatureApiService', () => {
  let service: FeatureApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(FeatureApiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
