import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OAuthCallbackComponent } from './oauth-callback.component';
import { AuthStore } from '../../store/auth.store';
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
  let router: Router;

  beforeEach(async () => {
    authStoreMock = {
      saveAuthResponse: vi.fn()
    };

    authServiceMock = {
      scheduleTokenRefresh: vi.fn()
    };

    await TestBed.configureTestingModule({
      imports: [OAuthCallbackComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthStore, useValue: authStoreMock },
        { provide: AuthService, useValue: authServiceMock }
      ]
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl');
    vi.spyOn(router, 'navigate');
  });

  afterEach(() => {
    window.location.hash = '';
    sessionStorage.clear();
  });

  it('should parse fragment and save auth response', () => {
    const encoded = encodeAuthResponse(mockAuthResponse);
    window.location.hash = `#data=${encoded}`;

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
    window.location.hash = `#data=${encoded}`;
    sessionStorage.setItem('oauth_return_url', '/dashboard');

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/dashboard', {
      replaceUrl: true
    });
    expect(sessionStorage.getItem('oauth_return_url')).toBeNull();
  });

  it('should redirect to login on missing fragment data', () => {
    window.location.hash = '';

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { oauth_error: 'auth_failed' },
      replaceUrl: true
    });
  });

  it('should redirect to login on invalid JSON', () => {
    window.location.hash = '#data=not-valid-base64!!!';

    fixture = TestBed.createComponent(OAuthCallbackComponent);
    fixture.detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { oauth_error: 'auth_failed' },
      replaceUrl: true
    });
  });
});
