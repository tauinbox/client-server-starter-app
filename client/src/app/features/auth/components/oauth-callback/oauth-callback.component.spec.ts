import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError } from 'rxjs';

import { OAuthCallbackComponent } from './oauth-callback.component';
import { AuthStore } from '../../store/auth.store';
import { AuthService } from '../../services/auth.service';
import { SessionStorageService } from '@core/services/session-storage.service';
import type { AuthResponse } from '../../models/auth.types';

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
    roles: ['user'],
    isEmailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null
  }
};

describe('OAuthCallbackComponent', () => {
  let fixture: ComponentFixture<OAuthCallbackComponent>;
  let authStoreMock: {
    saveAuthResponse: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    scheduleTokenRefresh: ReturnType<typeof vi.fn>;
    exchangeOAuthData: ReturnType<typeof vi.fn>;
  };
  let sessionStorageMock: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };
  let router: Router;

  beforeEach(async () => {
    authStoreMock = {
      saveAuthResponse: vi.fn()
    };

    authServiceMock = {
      scheduleTokenRefresh: vi.fn(),
      exchangeOAuthData: vi.fn().mockReturnValue(of(mockAuthResponse))
    };

    sessionStorageMock = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [OAuthCallbackComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: SessionStorageService, useValue: sessionStorageMock }
      ]
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl');
    vi.spyOn(router, 'navigate');
  });

  it('should exchange OAuth data and save auth response', () => {
    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(authServiceMock.exchangeOAuthData).toHaveBeenCalled();
    expect(authStoreMock.saveAuthResponse).toHaveBeenCalledWith(
      mockAuthResponse
    );
    expect(authServiceMock.scheduleTokenRefresh).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/profile', {
      replaceUrl: true
    });
  });

  it('should navigate to returnUrl from sessionStorage', () => {
    sessionStorageMock.getItem.mockReturnValue('/dashboard');

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(sessionStorageMock.getItem).toHaveBeenCalledWith('oauth_return_url');
    expect(sessionStorageMock.removeItem).toHaveBeenCalledWith(
      'oauth_return_url'
    );
    expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard', {
      replaceUrl: true
    });
  });

  it('should redirect to login on exchange error', () => {
    authServiceMock.exchangeOAuthData.mockReturnValue(
      throwError(() => new Error('exchange failed'))
    );

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { oauth_error: 'auth_failed' },
      replaceUrl: true
    });
  });

  it('should redirect to login when auth response is missing required fields', () => {
    const incompleteResponse = {
      tokens: {
        access_token: 'token',
        refresh_token: 'refresh',
        expires_in: 3600
      },
      user: { id: '', email: '', firstName: 'Test', lastName: 'User' }
    };
    authServiceMock.exchangeOAuthData.mockReturnValue(of(incompleteResponse));

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { oauth_error: 'auth_failed' },
      replaceUrl: true
    });
  });

  it('should reject returnUrl with double slashes', () => {
    sessionStorageMock.getItem.mockReturnValue('//evil.com');

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/profile', {
      replaceUrl: true
    });
  });
});
