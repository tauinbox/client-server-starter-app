import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DOCUMENT } from '@angular/common';

import { OAuthCallbackComponent } from './oauth-callback.component';
import { AuthStore } from '../../store/auth.store';
import { AuthService } from '../../services/auth.service';
import { SessionStorageService } from '@core/services/session-storage.service';
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
    isEmailVerified: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date(),
    updatedAt: new Date()
  }
};

function encodeAuthResponse(response: AuthResponse): string {
  return btoa(JSON.stringify(response))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('OAuthCallbackComponent', () => {
  let fixture: ComponentFixture<OAuthCallbackComponent>;
  let authStoreMock: {
    saveAuthResponse: ReturnType<typeof vi.fn>;
  };
  let authServiceMock: {
    scheduleTokenRefresh: ReturnType<typeof vi.fn>;
  };
  let sessionStorageMock: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };
  let router: Router;
  let mockLocationHash: string;
  let mockDoc: Document;

  beforeEach(async () => {
    authStoreMock = {
      saveAuthResponse: vi.fn()
    };

    authServiceMock = {
      scheduleTokenRefresh: vi.fn()
    };

    sessionStorageMock = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };

    mockLocationHash = '';

    // Create a proxy for document that intercepts defaultView.location.hash
    const realDoc = document;
    const locationProxy = new Proxy(realDoc.defaultView!.location, {
      get(target, prop) {
        if (prop === 'hash') return mockLocationHash;
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    const viewProxy = new Proxy(realDoc.defaultView!, {
      get(target, prop) {
        if (prop === 'location') return locationProxy;
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    mockDoc = new Proxy(realDoc, {
      get(target, prop) {
        if (prop === 'defaultView') return viewProxy;
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });

    await TestBed.configureTestingModule({
      imports: [OAuthCallbackComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: SessionStorageService, useValue: sessionStorageMock },
        { provide: DOCUMENT, useValue: mockDoc }
      ]
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl');
    vi.spyOn(router, 'navigate');
  });

  it('should parse fragment and save auth response', () => {
    const encoded = encodeAuthResponse(mockAuthResponse);
    mockLocationHash = `#data=${encoded}`;

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(authStoreMock.saveAuthResponse).toHaveBeenCalled();
    expect(authServiceMock.scheduleTokenRefresh).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/profile', {
      replaceUrl: true
    });
  });

  it('should navigate to returnUrl from sessionStorage', () => {
    const encoded = encodeAuthResponse(mockAuthResponse);
    mockLocationHash = `#data=${encoded}`;
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

  it('should redirect to login on missing fragment data', () => {
    mockLocationHash = '';

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { oauth_error: 'auth_failed' },
      replaceUrl: true
    });
  });

  it('should redirect to login on invalid JSON', () => {
    mockLocationHash = '#data=not-valid-base64!!!';

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
    const encoded = encodeAuthResponse(incompleteResponse as AuthResponse);
    mockLocationHash = `#data=${encoded}`;

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { oauth_error: 'auth_failed' },
      replaceUrl: true
    });
  });

  it('should reject returnUrl with double slashes', () => {
    const encoded = encodeAuthResponse(mockAuthResponse);
    mockLocationHash = `#data=${encoded}`;
    sessionStorageMock.getItem.mockReturnValue('//evil.com');

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/profile', {
      replaceUrl: true
    });
  });
});
