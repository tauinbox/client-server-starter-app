import { TestBed } from '@angular/core/testing';

import { FeatureApiService } from './feature-api.service';

describe('FeatureApiService', () => {
  let service: FeatureApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(FeatureApiService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
