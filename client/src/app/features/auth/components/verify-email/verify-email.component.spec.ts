import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { VerifyEmailComponent } from './verify-email.component';
import { AuthService } from '../../services/auth.service';

describe('VerifyEmailComponent', () => {
  let component: VerifyEmailComponent;
  let fixture: ComponentFixture<VerifyEmailComponent>;
  let authServiceMock: { verifyEmail: ReturnType<typeof vi.fn> };

  function createComponent(token: string | undefined): void {
    TestBed.configureTestingModule({
      imports: [VerifyEmailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParams: token ? { token } : {}
            }
          }
        }
      ]
    });

    fixture = TestBed.createComponent(VerifyEmailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    authServiceMock = {
      verifyEmail: vi.fn()
    };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('should create', () => {
    authServiceMock.verifyEmail.mockReturnValue(
      of({ message: 'Email verified' })
    );
    createComponent('valid-token');
    expect(component).toBeTruthy();
  });

  describe('ngOnInit — no token', () => {
    it('should set error and stop loading when no token provided', () => {
      createComponent(undefined);

      expect(component['loading']()).toBe(false);
      expect(component['success']()).toBe(false);
      expect(component['error']()).toBe('No verification token provided.');
    });

    it('should not call verifyEmail when token is missing', () => {
      createComponent(undefined);
      expect(authServiceMock.verifyEmail).not.toHaveBeenCalled();
    });
  });

  describe('ngOnInit — with token', () => {
    it('should call verifyEmail with the token from query params', () => {
      authServiceMock.verifyEmail.mockReturnValue(
        of({ message: 'Email verified' })
      );
      createComponent('my-verification-token');

      expect(authServiceMock.verifyEmail).toHaveBeenCalledWith(
        'my-verification-token'
      );
    });

    it('should set success to true and loading to false on success', () => {
      authServiceMock.verifyEmail.mockReturnValue(
        of({ message: 'Email verified' })
      );
      createComponent('valid-token');

      expect(component['loading']()).toBe(false);
      expect(component['success']()).toBe(true);
      expect(component['error']()).toBeNull();
    });

    it('should set error from server on failure', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Token expired' },
        status: 400
      });
      authServiceMock.verifyEmail.mockReturnValue(throwError(() => httpError));
      createComponent('expired-token');

      expect(component['loading']()).toBe(false);
      expect(component['success']()).toBe(false);
      expect(component['error']()).toBe('Token expired');
    });

    it('should show fallback error when no server message on failure', () => {
      const httpError = new HttpErrorResponse({ error: null, status: 500 });
      authServiceMock.verifyEmail.mockReturnValue(throwError(() => httpError));
      createComponent('some-token');

      expect(component['error']()).toBe(
        'Email verification failed. The token may be invalid or expired.'
      );
    });
  });
});
