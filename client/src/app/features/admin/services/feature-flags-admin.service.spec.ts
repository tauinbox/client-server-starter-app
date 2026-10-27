import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { FeatureFlagsAdminService } from './feature-flags-admin.service';

const ADMIN_API_V1 = '/api/v1/admin/feature-flags';

describe('FeatureFlagsAdminService', () => {
  let service: FeatureFlagsAdminService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        FeatureFlagsAdminService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(FeatureFlagsAdminService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // The server reads If-Match by the RFC 9110 grammar, so a bare number is a
  // malformed header and answers 400.
  it('sends the expected version as a quoted entity tag', () => {
    service.update('flag-1', { enabled: true }, 7).subscribe();

    const req = httpMock.expectOne(`${ADMIN_API_V1}/flag-1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.headers.get('If-Match')).toBe('"7"');
    req.flush({});
  });
});
