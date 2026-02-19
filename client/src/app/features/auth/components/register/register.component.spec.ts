import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

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
      imports: [RegisterComponent],
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
      expect(component.registerForm.valid).toBe(false);
    });

    it('should require email', () => {
      expect(component.registerForm.controls.email.hasError('required')).toBe(
        true
      );
    });

    it('should validate email format', () => {
      const emailControl = component.registerForm.controls.email;
      emailControl.setValue('invalid');
      expect(emailControl.hasError('email')).toBe(true);
    });

    it('should require firstName', () => {
      expect(
        component.registerForm.controls.firstName.hasError('required')
      ).toBe(true);
    });

    it('should require lastName', () => {
      expect(
        component.registerForm.controls.lastName.hasError('required')
      ).toBe(true);
    });

    it('should require password', () => {
      expect(
        component.registerForm.controls.password.hasError('required')
      ).toBe(true);
    });

    it('should enforce password minLength of 8', () => {
      const passwordControl = component.registerForm.controls.password;
      passwordControl.setValue('short');
      expect(passwordControl.hasError('minlength')).toBe(true);

      passwordControl.setValue('longpassword');
      expect(passwordControl.hasError('minlength')).toBe(false);
    });

    it('should be valid with correct values', () => {
      component.registerForm.setValue({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        password: 'password123'
      });
      expect(component.registerForm.valid).toBe(true);
    });
  });

  describe('togglePasswordVisibility', () => {
    it('should toggle showPassword signal', () => {
      expect(component['showPassword']()).toBe(false);
      component.togglePasswordVisibility();
      expect(component['showPassword']()).toBe(true);
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

      component.registerForm.setValue(validForm);
      component.onSubmit();

      expect(authServiceMock.register).toHaveBeenCalledWith(validForm);
    });

    it('should navigate to login with pending-verification on success', () => {
      authServiceMock.register.mockReturnValue(of(mockRegisterResponse));
      vi.spyOn(router, 'navigate');

      component.registerForm.setValue(validForm);
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

      component.registerForm.setValue(validForm);
      component.onSubmit();

      expect(component['error']()).toBe('User with this email already exists.');
      expect(component['loading']()).toBe(false);
    });

    it('should show server error message on other errors', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Validation failed' },
        status: 400
      });
      authServiceMock.register.mockReturnValue(throwError(() => httpError));

      component.registerForm.setValue(validForm);
      component.onSubmit();

      expect(component['error']()).toBe('Validation failed');
    });

    it('should show fallback error message when no server message', () => {
      const httpError = new HttpErrorResponse({
        error: null,
        status: 500
      });
      authServiceMock.register.mockReturnValue(throwError(() => httpError));

      component.registerForm.setValue(validForm);
      component.onSubmit();

      expect(component['error']()).toBe(
        'Registration failed. Please try again.'
      );
    });
  });
});
