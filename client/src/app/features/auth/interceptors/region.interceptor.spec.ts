import { TestBed } from '@angular/core/testing';
import { DOCUMENT, signal } from '@angular/core';
import {
  HttpClient,
  HttpContext,
  provideHttpClient,
  withInterceptors
} from '@angular/common/http';
import { API_REGION_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/api-region';
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

const regionContext = (value: DataRegion) =>
  new HttpContext().set(API_REGION_HTTP_CONTEXT_TOKEN, value);

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

  it('sends a call with the region of its context to that host, without the token of the session region', () => {
    http
      .post(
        '/api/v1/auth/verify-email',
        {},
        { context: regionContext(OTHER_REGION) }
      )
      .subscribe();

    const host = `${REGIONS[OTHER_REGION].apiSubdomain}.${location.host}`;
    const { request } = httpMock.expectOne(
      `${location.protocol}//${host}/api/v1/auth/verify-email`
    );

    expect(request.withCredentials).toBe(true);
    expect(request.headers.has('Authorization')).toBe(false);
  });

  it('sends a call with the home region in its context to the SPA origin, without the token of another region', () => {
    region.set(OTHER_REGION);
    http
      .post(
        '/api/v1/auth/verify-email',
        {},
        { context: regionContext(HOME_DATA_REGION) }
      )
      .subscribe();

    const { request } = httpMock.expectOne('/api/v1/auth/verify-email');

    expect(request.withCredentials).toBe(false);
    expect(request.headers.has('Authorization')).toBe(false);
  });

  it('keeps the token when the region of the context is the region of the session', () => {
    region.set(OTHER_REGION);
    http
      .post(
        '/api/v1/auth/verify-email',
        {},
        { context: regionContext(OTHER_REGION) }
      )
      .subscribe();

    const host = `${REGIONS[OTHER_REGION].apiSubdomain}.${location.host}`;
    const { request } = httpMock.expectOne(
      `${location.protocol}//${host}/api/v1/auth/verify-email`
    );

    expect(request.headers.get('Authorization')).toBe('Bearer access-token');
  });

  it('leaves a call outside the API on the origin of the SPA', () => {
    region.set(OTHER_REGION);
    http.get('/assets/i18n/en.json').subscribe();

    const { request } = httpMock.expectOne('/assets/i18n/en.json');

    expect(request.withCredentials).toBe(false);
  });
});
