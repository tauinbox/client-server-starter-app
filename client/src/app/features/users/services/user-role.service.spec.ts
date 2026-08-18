import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { UserRoleService } from './user-role.service';

const ROLES_API_V1 = '/api/v1/roles';

describe('UserRoleService', () => {
  let service: UserRoleService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        UserRoleService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    service = TestBed.inject(UserRoleService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('POSTs the role id to the assign route of the user', () => {
    service.assignRole('user-1', 'role-1').subscribe();

    const req = httpMock.expectOne(`${ROLES_API_V1}/assign/user-1`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ roleId: 'role-1' });
    req.flush(null);
  });

  it('DELETEs the user/role pair', () => {
    service.removeRole('user-1', 'role-1').subscribe();

    const req = httpMock.expectOne(`${ROLES_API_V1}/assign/user-1/role-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
