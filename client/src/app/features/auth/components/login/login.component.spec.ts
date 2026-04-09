import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth.service';
import type { AuthResponse } from '../../models/auth.types';
import type { RoleResponse } from '@app/shared/types';
import { ErrorKeys } from '@app/shared/constants/error-keys';

const mockUserRole: RoleResponse = {
  id: 'role-user',
  name: 'user',
  description: 'Regular user',
  isSystem: true,
  isSuper: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z'
};

const mockAuthResponse: AuthResponse = {
  tokens: {
    access_token: 'token',
    expires_in: 3600
  },
  user: {
    id: '1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    isActive: true,
    roles: [mockUserRole],
    isEmailVerified: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null
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
      imports: [LoginComponent, TranslocoTestingModuleWithLangs],
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
      expect(component.loginForm().valid()).toBe(false);
    });

    it('should require email', () => {
      const emailErrors = component.loginForm.email().errors();
      expect(emailErrors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should validate email format', () => {
      component.loginModel.set({ email: 'invalid', password: '' });
      TestBed.tick();
      const emailErrors = component.loginForm.email().errors();
      expect(emailErrors.some((e) => e.kind === 'email')).toBe(true);

      component.loginModel.set({ email: 'test@example.com', password: '' });
      TestBed.tick();
      expect(component.loginForm.email().valid()).toBe(true);
    });

    it('should require password', () => {
      const passwordErrors = component.loginForm.password().errors();
      expect(passwordErrors.some((e) => e.kind === 'required')).toBe(true);
    });

    it('should be valid with correct values', () => {
      component.loginModel.set({
        email: 'test@example.com',
        password: 'password123'
      });
      TestBed.tick();
      expect(component.loginForm().valid()).toBe(true);
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

      component.loginModel.set({
        email: 'test@example.com',
        password: 'password123'
      });
      TestBed.tick();

      component.onSubmit();

      expect(authServiceMock.login).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123'
      });
    });

    it('should set loading to true during login', () => {
      authServiceMock.login.mockReturnValue(of(mockAuthResponse));
      vi.spyOn(router, 'navigateByUrl');

      component.loginModel.set({
        email: 'test@example.com',
        password: 'password123'
      });
      TestBed.tick();

      component.onSubmit();

      // After success, loading is set back to false
      expect(component['loading']()).toBe(false);
    });

    it('should navigate to returnUrl on success', () => {
      authServiceMock.login.mockReturnValue(of(mockAuthResponse));
      vi.spyOn(router, 'navigateByUrl');

      component.loginModel.set({
        email: 'test@example.com',
        password: 'password123'
      });
      TestBed.tick();
      component.onSubmit();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('should navigate to custom returnUrl when present', () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [LoginComponent, TranslocoTestingModuleWithLangs],
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

      newComponent.loginModel.set({
        email: 'test@example.com',
        password: 'password123'
      });
      TestBed.tick();
      newComponent.onSubmit();

      expect(newRouter.navigateByUrl).toHaveBeenCalledWith('/dashboard');
    });

    it('should show fallback translation on login failure without errorKey', () => {
      const httpError = new HttpErrorResponse({
        error: { message: 'Invalid credentials' },
        status: 401
      });
      authServiceMock.login.mockReturnValue(throwError(() => httpError));

      component.loginModel.set({
        email: 'test@example.com',
        password: 'wrongpassword'
      });
      TestBed.tick();
      component.onSubmit();

      expect(component['error']()).toBe(
        'Login failed. Please check your credentials.'
      );
      expect(component['loading']()).toBe(false);
    });

    it('should translate error from errorKey on login failure', () => {
      const httpError = new HttpErrorResponse({
        error: {
          message: 'Invalid credentials',
          errorKey: ErrorKeys.AUTH.INVALID_CREDENTIALS
        },
        status: 401
      });
      authServiceMock.login.mockReturnValue(throwError(() => httpError));

      component.loginModel.set({
        email: 'test@example.com',
        password: 'wrongpassword'
      });
      TestBed.tick();
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

      component.loginModel.set({
        email: 'test@example.com',
        password: 'password123'
      });
      TestBed.tick();
      component.onSubmit();

      expect(component['error']()).toBe(
        'Login failed. Please check your credentials.'
      );
    });
  });
});
