import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';
import { ErrorKeys } from '@app/shared/constants/error-keys';

import { RegisterComponent } from './register.component';
import { AuthService } from '../../services/auth.service';

const mockRegisterResponse = {
  message:
    'Registration successful. Please check your email to verify your account.'
};

describe('RegisterComponent', () => {
  let component: RegisterComponent;
  let fixture: ComponentFixture<RegisterComponent>;
  let authServiceMock: { register: ReturnType<typeof vi.fn> };
  let router: Router;

  beforeEach(async () => {
    authServiceMock = { register: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [RegisterComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('form validation', () => {
    it('should be invalid when empty', () => {
      expect(component.registerForm().valid()).toBe(false);
    });

    it('should require email', () => {
      const emailErrors = component.registerForm.email().errors();
      expect(emailErrors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should validate email format', () => {
      component.registerModel.set({
        email: 'invalid',
        firstName: '',
        lastName: '',
        password: ''
      });
      TestBed.tick();
      const emailErrors = component.registerForm.email().errors();
      expect(emailErrors.some((e) => e.kind === 'email')).toBe(true);

      component.registerModel.set({
        email: 'test@example.com',
        firstName: '',
        lastName: '',
        password: ''
      });
      TestBed.tick();
      expect(component.registerForm.email().valid()).toBe(true);
    });

    it('should require firstName', () => {
      const errors = component.registerForm.firstName().errors();
      expect(errors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should require lastName', () => {
      const errors = component.registerForm.lastName().errors();
      expect(errors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should require password', () => {
      const errors = component.registerForm.password().errors();
      expect(errors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should enforce password minLength of 8', () => {
      component.registerModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: 'short'
      });
      TestBed.tick();
      const errors = component.registerForm.password().errors();
      expect(errors.some((e) => e.kind === 'minLength')).toBe(true);

      component.registerModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: 'longpassword'
      });
      TestBed.tick();
      expect(component.registerForm.password().valid()).toBe(true);
    });

    it('should be valid with correct values', () => {
      component.registerModel.set({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: 'password123'
      });
      TestBed.tick();
      expect(component.registerForm().valid()).toBe(true);
    });
  });

  describe('onSubmit', () => {
    const validForm = {
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      password: 'password123'
    };

    it('should not call register when form is invalid', () => {
      component.onSubmit();
      expect(authServiceMock.register).not.toHaveBeenCalled();
    });

    it('should call register with form values', () => {
      authServiceMock.register.mockReturnValue(of(mockRegisterResponse));
      vi.spyOn(router, 'navigate');

      component.registerModel.set(validForm);
      TestBed.tick();
      component.onSubmit();

      expect(authServiceMock.register).toHaveBeenCalledWith(validForm);
    });

    it('should navigate to login with pending-verification on success', () => {
      authServiceMock.register.mockReturnValue(of(mockRegisterResponse));
      vi.spyOn(router, 'navigate');

      component.registerModel.set(validForm);
      TestBed.tick();
      component.onSubmit();

      expect(router.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: { registered: 'pending-verification' }
      });
      expect(component['loading']()).toBe(false);
    });

    it('should show "email exists" error on 409', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Conflict' },
        status: 409
      });
      authServiceMock.register.mockReturnValue(throwError(() => httpError));

      component.registerModel.set(validForm);
      TestBed.tick();
      component.onSubmit();

      expect(component['error']()).toBe('User with this email already exists.');
      expect(component['loading']()).toBe(false);
    });

    it('should show fallback translation on non-409 error without errorKey', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Validation failed' },
        status: 400
      });
      authServiceMock.register.mockReturnValue(throwError(() => httpError));

      component.registerModel.set(validForm);
      TestBed.tick();
      component.onSubmit();

      expect(component['error']()).toBe(
        'Registration failed. Please try again.'
      );
    });

    it('should translate error from errorKey on non-409 error', () => {
      const httpError = new HttpErrorResponse({
        error: {
          message: 'Validation failed',
          errorKey: ErrorKeys.GENERAL.INTERNAL_SERVER_ERROR
        },
        status: 500
      });
      authServiceMock.register.mockReturnValue(throwError(() => httpError));

      component.registerModel.set(validForm);
      TestBed.tick();
      component.onSubmit();

      expect(component['error']()).toBe('Internal server error');
    });

    it('should show fallback error message when no server message', () => {
      const httpError = new HttpErrorResponse({
        error: null,
        status: 500
      });
      authServiceMock.register.mockReturnValue(throwError(() => httpError));

      component.registerModel.set(validForm);
      TestBed.tick();
      component.onSubmit();

      expect(component['error']()).toBe(
        'Registration failed. Please try again.'
      );
    });
  });
});
