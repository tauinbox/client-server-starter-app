import { TestBed } from '@angular/core/testing';
import { convertToParamMap, provideRouter } from '@angular/router';
import type {
  ActivatedRouteSnapshot,
  RouterStateSnapshot
} from '@angular/router';
import { of } from 'rxjs';
import { residenceGuard } from './residence.guard';
import { AuthStore } from '../store/auth.store';
import { AuthService } from '../services/auth.service';

describe('residenceGuard', () => {
  let authStoreMock: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    isAccessTokenExpired: ReturnType<typeof vi.fn>;
    hasPersistedUser: ReturnType<typeof vi.fn>;
    mustDeclareResidence: ReturnType<typeof vi.fn>;
  };

  const run = (returnUrl: string | null) => {
    const route = {
      queryParamMap: convertToParamMap(returnUrl ? { returnUrl } : {})
    } as ActivatedRouteSnapshot;
    const state = {
      url: returnUrl
        ? `/residence?returnUrl=${encodeURIComponent(returnUrl)}`
        : '/residence'
    } as RouterStateSnapshot;

    return TestBed.runInInjectionContext(() => residenceGuard(route, state));
  };

  beforeEach(() => {
    authStoreMock = {
      isAuthenticated: vi.fn().mockReturnValue(true),
      isAccessTokenExpired: vi.fn().mockReturnValue(false),
      hasPersistedUser: vi.fn().mockReturnValue(true),
      mustDeclareResidence: vi.fn().mockReturnValue(true)
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: authStoreMock },
        {
          provide: AuthService,
          useValue: {
            refreshTokens: vi.fn().mockReturnValue(of(null)),
            clearSession: vi.fn()
          }
        }
      ]
    });
  });

  it('opens the page to an account with no country', () => {
    expect(run('/billing')).toBe(true);
  });

  it('sends an account that has a country on to its target', () => {
    authStoreMock.mustDeclareResidence.mockReturnValue(false);

    expect(String(run('/billing?tab=plans'))).toBe('/billing?tab=plans');
  });

  it('sends an account that has a country to the root without a target', () => {
    authStoreMock.mustDeclareResidence.mockReturnValue(false);

    expect(String(run(null))).toBe('/');
  });

  it('sends a signed-out visitor to the sign-in page', () => {
    authStoreMock.isAuthenticated.mockReturnValue(false);
    authStoreMock.hasPersistedUser.mockReturnValue(false);

    expect(String(run(null))).toBe('/login?returnUrl=%2Fresidence');
  });
});
