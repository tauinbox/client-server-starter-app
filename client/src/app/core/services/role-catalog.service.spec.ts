import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { RoleCatalogService } from './role-catalog.service';

const ROLES_API_V1 = '/api/v1/roles';

describe('RoleCatalogService', () => {
  let service: RoleCatalogService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        RoleCatalogService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(RoleCatalogService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GETs the whole catalog without pagination params', () => {
    service.getAll().subscribe();

    const req = httpMock.expectOne(ROLES_API_V1);
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush([]);
  });

  it('emits the roles the server returned', () => {
    const roles = [{ id: 'role-1', name: 'user' }];
    let received: unknown;
    service.getAll().subscribe((value) => (received = value));

    httpMock.expectOne(ROLES_API_V1).flush(roles);
    expect(received).toEqual(roles);
  });
});
