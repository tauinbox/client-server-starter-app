import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ResetPasswordComponent } from './reset-password.component';
import { AuthService } from '../../services/auth.service';

describe('ResetPasswordComponent', () => {
  let component: ResetPasswordComponent;
  let fixture: ComponentFixture<ResetPasswordComponent>;
  let authServiceMock: { resetPassword: ReturnType<typeof vi.fn> };
  let router: Router;

  function createComponent(token: string | undefined): void {
    TestBed.configureTestingModule({
      imports: [ResetPasswordComponent],
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

    fixture = TestBed.createComponent(ResetPasswordComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  }

  beforeEach(() => {
    authServiceMock = {
      resetPassword: vi.fn()
    };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('should create', () => {
    createComponent('valid-token');
    expect(component).toBeTruthy();
  });

  describe('ngOnInit — token handling', () => {
    it('should read token from query params', () => {
      createComponent('my-reset-token');
      expect(component['invalidToken']()).toBe(false);
      expect(component['error']()).toBeNull();
    });

    it('should set invalidToken and error when no token provided', () => {
      createComponent(undefined);
      expect(component['invalidToken']()).toBe(true);
      expect(component['error']()).toBe('No reset token provided.');
    });
  });

  describe('form validation', () => {
    beforeEach(() => {
      createComponent('valid-token');
    });

    it('should be invalid when empty', () => {
      expect(component.resetPasswordForm.invalid).toBe(true);
    });

    it('should require password', () => {
      expect(
        component.resetPasswordForm.controls.password.hasError('required')
      ).toBe(true);
    });

    it('should validate password minLength of 8', () => {
      component.resetPasswordForm.controls.password.setValue('short');
      expect(
        component.resetPasswordForm.controls.password.hasError('minlength')
      ).toBe(true);
    });

    it('should accept password of 8+ characters', () => {
      component.resetPasswordForm.controls.password.setValue('validpass');
      expect(component.resetPasswordForm.controls.password.valid).toBe(true);
    });

    it('should require confirmPassword', () => {
      expect(
        component.resetPasswordForm.controls.confirmPassword.hasError(
          'required'
        )
      ).toBe(true);
    });

    it('should have passwordsMismatch error when passwords differ', () => {
      component.resetPasswordForm.setValue({
        password: 'Password1',
        confirmPassword: 'Different1'
      });
      expect(component.resetPasswordForm.hasError('passwordsMismatch')).toBe(
        true
      );
    });

    it('should be valid when passwords match and meet requirements', () => {
      component.resetPasswordForm.setValue({
        password: 'Password1',
        confirmPassword: 'Password1'
      });
      expect(component.resetPasswordForm.valid).toBe(true);
    });
  });

  describe('onSubmit', () => {
    beforeEach(() => {
      createComponent('valid-token');
    });

    it('should not submit when form is invalid', () => {
      component.onSubmit();
      expect(authServiceMock.resetPassword).not.toHaveBeenCalled();
    });

    it('should call resetPassword with token and password', () => {
      authServiceMock.resetPassword.mockReturnValue(of(void 0));
      component.resetPasswordForm.setValue({
        password: 'NewPassword1',
        confirmPassword: 'NewPassword1'
      });

      component.onSubmit();

      expect(authServiceMock.resetPassword).toHaveBeenCalledWith(
        'valid-token',
        'NewPassword1'
      );
    });

    it('should navigate to /login on success', () => {
      authServiceMock.resetPassword.mockReturnValue(of(void 0));
      const navigateSpy = vi.spyOn(router, 'navigate');
      component.resetPasswordForm.setValue({
        password: 'NewPassword1',
        confirmPassword: 'NewPassword1'
      });

      component.onSubmit();

      expect(navigateSpy).toHaveBeenCalledWith(['/login']);
    });

    it('should set error from server on failure', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Token expired' },
        status: 400
      });
      authServiceMock.resetPassword.mockReturnValue(
        throwError(() => httpError)
      );
      component.resetPasswordForm.setValue({
        password: 'NewPassword1',
        confirmPassword: 'NewPassword1'
      });

      component.onSubmit();

      expect(component['error']()).toBe('Token expired');
      expect(component['loading']()).toBe(false);
    });

    it('should show fallback error when no server message', () => {
      const httpError = new HttpErrorResponse({ error: null, status: 500 });
      authServiceMock.resetPassword.mockReturnValue(
        throwError(() => httpError)
      );
      component.resetPasswordForm.setValue({
        password: 'NewPassword1',
        confirmPassword: 'NewPassword1'
      });

      component.onSubmit();

      expect(component['error']()).toBe(
        'Password reset failed. The token may be invalid or expired.'
      );
    });
  });

  describe('onSubmit — missing token', () => {
    it('should not submit when token is missing', () => {
      createComponent(undefined);
      component.resetPasswordForm.setValue({
        password: 'NewPassword1',
        confirmPassword: 'NewPassword1'
      });

      component.onSubmit();

      expect(authServiceMock.resetPassword).not.toHaveBeenCalled();
    });
  });
});
