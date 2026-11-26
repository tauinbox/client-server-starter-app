import { TestBed } from '@angular/core/testing';
import { DOCUMENT, signal } from '@angular/core';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import {
  DATA_REGIONS,
  HOME_DATA_REGION,
  REGIONS,
  type DataRegion
} from '@app/shared/constants';
import { jwtInterceptor } from './jwt.interceptor';
import { regionInterceptor } from './region.interceptor';
import { AuthStore } from '../store/auth.store';
import { TokenService } from '../services/token.service';

const [OTHER_REGION] = DATA_REGIONS.filter(
  (region) => REGIONS[region].apiSubdomain !== null
);

describe('regionInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let location: Location;
  const region = signal<DataRegion>(HOME_DATA_REGION);

  beforeEach(() => {
    region.set(HOME_DATA_REGION);
    TestBed.configureTestingModule({
      providers: [
        // The order of app.config.ts.
        provideHttpClient(
          withInterceptors([jwtInterceptor, regionInterceptor])
        ),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: AuthStore,
          useValue: { region, getAccessToken: () => 'access-token' }
        },
        { provide: TokenService, useValue: {} }
      ]
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    ({ location } = TestBed.inject(DOCUMENT).defaultView as Window);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('keeps an API call of the home region on the origin of the SPA', () => {
    http.get('/api/v1/users/me').subscribe();

    const { request } = httpMock.expectOne('/api/v1/users/me');

    expect(request.withCredentials).toBe(false);
    expect(request.headers.get('Authorization')).toBe('Bearer access-token');
  });

  it('sends an API call of another region to its host, with the cookies and the token', () => {
    region.set(OTHER_REGION);
    http.get('/api/v1/users/me').subscribe();

    const host = `${REGIONS[OTHER_REGION].apiSubdomain}.${location.host}`;
    const { request } = httpMock.expectOne(
      `${location.protocol}//${host}/api/v1/users/me`
    );

    expect(request.withCredentials).toBe(true);
    expect(request.headers.get('Authorization')).toBe('Bearer access-token');
  });

  it('leaves a call outside the API on the origin of the SPA', () => {
    region.set(OTHER_REGION);
    http.get('/assets/i18n/en.json').subscribe();

    const { request } = httpMock.expectOne('/assets/i18n/en.json');

    expect(request.withCredentials).toBe(false);
  });
});
