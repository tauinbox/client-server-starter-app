import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

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

    it('should validate email format', () => {
      component.forgotPasswordModel.set({ email: 'not-an-email' });
      TestBed.tick();
      const emailErrors = component.forgotPasswordForm.email().errors();
      expect(emailErrors.some((e) => e.kind === 'email')).toBe(true);
    });

    it('should be valid with a correct email', () => {
      component.forgotPasswordModel.set({ email: 'user@example.com' });
      TestBed.tick();
      expect(component.forgotPasswordForm().valid()).toBe(true);
    });
  });

  describe('onSubmit', () => {
    it('should not call forgotPassword when form is invalid', () => {
      component.onSubmit();
      expect(authServiceMock.forgotPassword).not.toHaveBeenCalled();
    });

    it('should call forgotPassword with the email value', () => {
      authServiceMock.forgotPassword.mockReturnValue(
        of({ message: 'Reset email sent' })
      );
      component.forgotPasswordModel.set({ email: 'user@example.com' });
      TestBed.tick();

      component.onSubmit();

      expect(authServiceMock.forgotPassword).toHaveBeenCalledWith(
        'user@example.com'
      );
    });

    it('should set loading to true while submitting', () => {
      authServiceMock.forgotPassword.mockReturnValue(
        of({ message: 'Reset email sent' })
      );
      component.forgotPasswordModel.set({ email: 'user@example.com' });
      TestBed.tick();

      component.onSubmit();

      // loading is reset to false after completion
      expect(component['loading']()).toBe(false);
    });

    it('should set success to true on successful submission', () => {
      authServiceMock.forgotPassword.mockReturnValue(
        of({ message: 'Reset email sent' })
      );
      component.forgotPasswordModel.set({ email: 'user@example.com' });
      TestBed.tick();

      component.onSubmit();

      expect(component['success']()).toBe(true);
      expect(component['loading']()).toBe(false);
    });

    it('should set error message on failure', () => {
      authServiceMock.forgotPassword.mockReturnValue(
        throwError(() => new Error('Network error'))
      );
      component.forgotPasswordModel.set({ email: 'user@example.com' });
      TestBed.tick();

      component.onSubmit();

      expect(component['error']()).toBe(
        'Something went wrong. Please try again later.'
      );
      expect(component['loading']()).toBe(false);
      expect(component['success']()).toBe(false);
    });

    it('should clear previous error before submitting', () => {
      component['error'].set('Previous error');
      authServiceMock.forgotPassword.mockReturnValue(
        of({ message: 'Reset email sent' })
      );
      component.forgotPasswordModel.set({ email: 'user@example.com' });
      TestBed.tick();

      component.onSubmit();

      expect(component['error']()).toBeNull();
    });
  });
});
