import type { Mock } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter, Router } from '@angular/router';
import {
  currentReturnUrl,
  loginUrlTree,
  navigateToLogin
} from './navigate-to-login';

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

@Component({ template: '' })
class BlankComponent {}

describe('currentReturnUrl', () => {
  let router: Router;
  let location: Location;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: BlankComponent }]),
        provideLocationMocks()
      ]
    });
    router = TestBed.inject(Router);
    location = TestBed.inject(Location);
  });

  it('should return the address bar before the first navigation ends', () => {
    location.go('/profile?tab=security');

    expect(router.url).toBe('/');
    expect(currentReturnUrl(router, location)).toBe('/profile?tab=security');
  });

  it('should return the router URL after the first navigation', async () => {
    await router.navigateByUrl('/users/1');
    location.go('/elsewhere');

    expect(currentReturnUrl(router, location)).toBe('/users/1');
  });
});
