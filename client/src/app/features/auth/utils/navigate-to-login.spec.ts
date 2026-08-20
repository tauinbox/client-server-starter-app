import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { loginUrlTree, navigateToLogin } from './navigate-to-login';

describe('navigateToLogin', () => {
  let router: Router;
  let navigateSpy: Mock<Router['navigate']>;

  beforeEach(() => {
    navigateSpy = vi.fn<Router['navigate']>();
    // @ts-expect-error testing mock - partial Router, only navigate is used
    router = { navigate: navigateSpy };
  });

  it('should navigate to login with returnUrl query param', () => {
    navigateToLogin(router, '/dashboard');

    expect(navigateSpy).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/dashboard' }
    });
  });

  it('should navigate to login with root returnUrl', () => {
    navigateToLogin(router, '/');

    expect(navigateSpy).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/' }
    });
  });
});

describe('loginUrlTree', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('should build the target the imperative helper navigates to', () => {
    const router = TestBed.inject(Router);

    expect(loginUrlTree(router, '/dashboard').toString()).toBe(
      '/login?returnUrl=%2Fdashboard'
    );
  });
});
