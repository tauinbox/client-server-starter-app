import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { ErrorKeys } from '@app/shared/constants/error-keys';

import { ForgotPasswordComponent } from './forgot-password.component';
import { AuthService } from '../../services/auth.service';

describe('ForgotPasswordComponent', () => {
  let component: ForgotPasswordComponent;
  let fixture: ComponentFixture<ForgotPasswordComponent>;
  let authServiceMock: { forgotPassword: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authServiceMock = {
      forgotPassword: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [ForgotPasswordComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ForgotPasswordComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('form validation', () => {
    it('should be invalid when empty', () => {
      expect(component.forgotPasswordForm().valid()).toBe(false);
    });

    it('should require email', () => {
      const emailErrors = component.forgotPasswordForm.email().errors();
      expect(emailErrors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should validate email format', async () => {
      component.forgotPasswordModel.set({ email: 'not-an-email' });
      await fixture.whenStable();
      const emailErrors = component.forgotPasswordForm.email().errors();
      expect(emailErrors.some((e) => e.kind === 'email')).toBe(true);
    });

    it('should be valid with a correct email', async () => {
      component.forgotPasswordModel.set({ email: 'user@example.com' });
      await fixture.whenStable();
      expect(component.forgotPasswordForm().valid()).toBe(true);
    });
  });

  describe('onSubmit', () => {
    it('should not call forgotPassword when form is invalid', () => {
      component.onSubmit();
      expect(authServiceMock.forgotPassword).not.toHaveBeenCalled();
    });

    it('should call forgotPassword with the email value', async () => {
      authServiceMock.forgotPassword.mockReturnValue(
        of({ message: 'Reset email sent' })
      );
      component.forgotPasswordModel.set({ email: 'user@example.com' });
      await fixture.whenStable();

      component.onSubmit();

      expect(authServiceMock.forgotPassword).toHaveBeenCalledWith(
        'user@example.com',
        null
      );
    });

    it('should set loading to true while submitting', async () => {
      authServiceMock.forgotPassword.mockReturnValue(
        of({ message: 'Reset email sent' })
      );
      component.forgotPasswordModel.set({ email: 'user@example.com' });
      await fixture.whenStable();

      component.onSubmit();

      // loading is reset to false after completion
      expect(component['loading']()).toBe(false);
    });

    it('should set success to true on successful submission', async () => {
      authServiceMock.forgotPassword.mockReturnValue(
        of({ message: 'Reset email sent' })
      );
      component.forgotPasswordModel.set({ email: 'user@example.com' });
      await fixture.whenStable();

      component.onSubmit();

      expect(component['success']()).toBe(true);
      expect(component['loading']()).toBe(false);
    });

    it('should set error message on failure', async () => {
      authServiceMock.forgotPassword.mockReturnValue(
        throwError(() => new Error('Network error'))
      );
      component.forgotPasswordModel.set({ email: 'user@example.com' });
      await fixture.whenStable();

      component.onSubmit();

      expect(component['error']()).toBe(
        'Something went wrong. Please try again later.'
      );
      expect(component['loading']()).toBe(false);
      expect(component['success']()).toBe(false);
    });

    it('should clear previous error before submitting', async () => {
      component['error'].set('Previous error');
      authServiceMock.forgotPassword.mockReturnValue(
        of({ message: 'Reset email sent' })
      );
      component.forgotPasswordModel.set({ email: 'user@example.com' });
      await fixture.whenStable();

      component.onSubmit();

      expect(component['error']()).toBeNull();
    });
  });

  describe('captcha soft-trigger', () => {
    const validEmail = { email: 'user@example.com' };

    it('shows captcha widget on CAPTCHA_REQUIRED and disables submit', async () => {
      const httpError = new HttpErrorResponse({
        error: {
          message: 'Captcha required',
          errorKey: ErrorKeys.AUTH.CAPTCHA_REQUIRED
        },
        status: 400
      });
      authServiceMock.forgotPassword.mockReturnValueOnce(
        throwError(() => httpError)
      );

      component.forgotPasswordModel.set(validEmail);
      await fixture.whenStable();
      component.onSubmit();

      expect(component['captchaRequired']()).toBe(true);
      expect(component['canSubmit']()).toBe(false);
      expect(component['error']()).toBe(
        'Please complete the CAPTCHA challenge to continue.'
      );
      expect(component['success']()).toBe(false);
    });

    it('passes captchaToken on retry after solving', async () => {
      const httpError = new HttpErrorResponse({
        error: {
          message: 'Captcha required',
          errorKey: ErrorKeys.AUTH.CAPTCHA_REQUIRED
        },
        status: 400
      });
      authServiceMock.forgotPassword
        .mockReturnValueOnce(throwError(() => httpError))
        .mockReturnValueOnce(of({ message: 'OK' }));

      component.forgotPasswordModel.set(validEmail);
      await fixture.whenStable();
      component.onSubmit();

      component['onCaptchaToken']('turnstile-token');
      expect(component['canSubmit']()).toBe(true);

      component.onSubmit();

      expect(authServiceMock.forgotPassword).toHaveBeenLastCalledWith(
        'user@example.com',
        'turnstile-token'
      );
      expect(component['success']()).toBe(true);
    });
  });
});
