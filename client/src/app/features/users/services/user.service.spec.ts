import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN } from '@core/context-tokens/error-notifications';
import { USERS_API_V1, UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [UserService, provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(UserService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // The edit form and the unlock action show the refusal; a snackbar would
  // show it a second time.
  it('PATCHes the user without the global error snackbar', () => {
    service.update('user-1', { firstName: 'Ann' }).subscribe();

    const req = httpMock.expectOne(`${USERS_API_V1}/user-1`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ firstName: 'Ann' });
    expect(
      req.request.context.get(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN)
    ).toBe(true);
    req.flush({});
  });

  it('keeps the global error snackbar on a read', () => {
    service.getById('user-1').subscribe();

    const req = httpMock.expectOne(`${USERS_API_V1}/user-1`);
    expect(
      req.request.context.get(DISABLE_ERROR_NOTIFICATIONS_HTTP_CONTEXT_TOKEN)
    ).toBe(false);
    req.flush({});
  });
});
