import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { RedirectFunction } from '@angular/router';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { routes } from './app.routes';
import { AuthStore } from '@features/auth/store/auth.store';
import { SidenavStateService } from '@core/services/sidenav-state.service';

function getRootRedirect(): RedirectFunction {
  const root = routes[0];
  if (typeof root?.redirectTo !== 'function') {
    throw new Error(
      'Root route is expected to define redirectTo as a function'
    );
  }
  return root.redirectTo;
}

function runRedirect(): string {
  const fn = getRootRedirect();
  return TestBed.runInInjectionContext(() => {
    const result = fn({} as never);
    if (typeof result !== 'string') {
      throw new Error(
        'Test setup expects the root redirect to return a string'
      );
    }
    return result;
  });
}

describe('app.routes root redirect', () => {
  let isAuthenticatedSignal: ReturnType<typeof signal<boolean>>;
  let defaultRouteSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    isAuthenticatedSignal = signal(false);
    defaultRouteSpy = vi.fn(() => '/profile');

    TestBed.configureTestingModule({
      providers: [
        {
          provide: AuthStore,
          useValue: { isAuthenticated: isAuthenticatedSignal }
        },
        {
          provide: SidenavStateService,
          useValue: { defaultRoute: defaultRouteSpy }
        }
      ]
    });
  });

  it('sends anonymous users to /login (no returnUrl)', () => {
    isAuthenticatedSignal.set(false);

    expect(runRedirect()).toBe('/login');
  });

  it('does not consult SidenavStateService for anonymous users', () => {
    isAuthenticatedSignal.set(false);
    runRedirect();

    expect(defaultRouteSpy).not.toHaveBeenCalled();
  });

  it('returns defaultRoute() for authenticated users', () => {
    isAuthenticatedSignal.set(true);
    defaultRouteSpy.mockReturnValue('/admin');

    expect(runRedirect()).toBe('/admin');
  });

  it('returns /profile fallback when authenticated user has no nav links', () => {
    isAuthenticatedSignal.set(true);
    defaultRouteSpy.mockReturnValue('/profile');

    expect(runRedirect()).toBe('/profile');
  });
});
