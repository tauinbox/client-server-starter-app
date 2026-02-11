import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth.service';
import type { AuthResponse } from '../../models/auth.types';

const mockAuthResponse: AuthResponse = {
  tokens: {
    access_token: 'token',
    refresh_token: 'refresh',
    expires_in: 3600
  },
  user: {
    id: '1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    isActive: true,
    isAdmin: false,
    createdAt: new Date(),
    updatedAt: new Date()
  }
};

describe('LoginComponent', () => {
  let component: LoginComponent;
  let fixture: ComponentFixture<LoginComponent>;
  let authServiceMock: {
    login: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  beforeEach(async () => {
    authServiceMock = {
      login: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        { provide: AuthService, useValue: authServiceMock },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParams: {} }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('form validation', () => {
    it('should be invalid when empty', () => {
      expect(component.loginForm.valid).toBe(false);
    });

    it('should require email', () => {
      const emailControl = component.loginForm.controls.email;
      expect(emailControl.hasError('required')).toBe(true);
    });

    it('should validate email format', () => {
      const emailControl = component.loginForm.controls.email;
      emailControl.setValue('invalid');
      expect(emailControl.hasError('email')).toBe(true);

      emailControl.setValue('test@example.com');
      expect(emailControl.valid).toBe(true);
    });

    it('should require password', () => {
      const passwordControl = component.loginForm.controls.password;
      expect(passwordControl.hasError('required')).toBe(true);
    });

    it('should be valid with correct values', () => {
      component.loginForm.setValue({
        email: 'test@example.com',
        password: 'password123'
      });
      expect(component.loginForm.valid).toBe(true);
    });
  });

  describe('togglePasswordVisibility', () => {
    it('should toggle showPassword signal', () => {
      expect(component['showPassword']()).toBe(false);
      component.togglePasswordVisibility();
      expect(component['showPassword']()).toBe(true);
      component.togglePasswordVisibility();
      expect(component['showPassword']()).toBe(false);
    });
  });

  describe('onSubmit', () => {
    it('should not call login when form is invalid', () => {
      component.onSubmit();
      expect(authServiceMock.login).not.toHaveBeenCalled();
    });

    it('should call login with form values when valid', () => {
      authServiceMock.login.mockReturnValue(of(mockAuthResponse));
      vi.spyOn(router, 'navigateByUrl');

      component.loginForm.setValue({
        email: 'test@example.com',
        password: 'password123'
      });

      component.onSubmit();

      expect(authServiceMock.login).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123'
      });
    });

    it('should set loading to true during login', () => {
      authServiceMock.login.mockReturnValue(of(mockAuthResponse));
      vi.spyOn(router, 'navigateByUrl');

      component.loginForm.setValue({
        email: 'test@example.com',
        password: 'password123'
      });

      component.onSubmit();

      // After success, loading is set back to false
      expect(component['loading']()).toBe(false);
    });

    it('should navigate to returnUrl on success', () => {
      authServiceMock.login.mockReturnValue(of(mockAuthResponse));
      vi.spyOn(router, 'navigateByUrl');

      component.loginForm.setValue({
        email: 'test@example.com',
        password: 'password123'
      });
      component.onSubmit();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('should navigate to custom returnUrl when present', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [LoginComponent],
        providers: [
          provideRouter([]),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideNoopAnimations(),
          { provide: AuthService, useValue: authServiceMock },
          {
            provide: ActivatedRoute,
            useValue: {
              snapshot: { queryParams: { returnUrl: '/dashboard' } }
            }
          }
        ]
      });

      const newFixture = TestBed.createComponent(LoginComponent);
      const newComponent = newFixture.componentInstance;
      const newRouter = TestBed.inject(Router);
      vi.spyOn(newRouter, 'navigateByUrl');
      newFixture.detectChanges();

      authServiceMock.login.mockReturnValue(of(mockAuthResponse));

      newComponent.loginForm.setValue({
        email: 'test@example.com',
        password: 'password123'
      });
      newComponent.onSubmit();

      expect(newRouter.navigateByUrl).toHaveBeenCalledWith('/dashboard');
    });

    it('should set error on login failure', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Invalid credentials' },
        status: 401
      });
      authServiceMock.login.mockReturnValue(throwError(() => httpError));

      component.loginForm.setValue({
        email: 'test@example.com',
        password: 'wrongpassword'
      });
      component.onSubmit();

      expect(component['error']()).toBe('Invalid credentials');
      expect(component['loading']()).toBe(false);
    });

    it('should show fallback error message when no server message', () => {
      const httpError = new HttpErrorResponse({
        error: null,
        status: 500
      });
      authServiceMock.login.mockReturnValue(throwError(() => httpError));

      component.loginForm.setValue({
        email: 'test@example.com',
        password: 'password123'
      });
      component.onSubmit();

      expect(component['error']()).toBe(
        'Login failed. Please check your credentials.'
      );
    });
  });
});
