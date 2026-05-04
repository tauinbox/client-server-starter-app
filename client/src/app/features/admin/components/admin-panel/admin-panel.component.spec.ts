import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { AdminPanelComponent } from './admin-panel.component';
import { AuthStore } from '@features/auth/store/auth.store';

// Regression for BKL-013. The route guard checks the OR-of-three permission
// set on navigation, but if an admin loses their privileges mid-session
// (SSE-driven RBAC update), the guard never re-runs. This component owns the
// "while inside /admin/*" check: the moment the live signal flips false, we
// must redirect to /forbidden so the user is not left staring at admin UI
// they can no longer act on.
describe('AdminPanelComponent — auto-redirect on permission loss (BKL-013)', () => {
  let fixture: ComponentFixture<AdminPanelComponent>;
  let canAccessSignal: ReturnType<typeof signal<boolean>>;
  let navigateSpy: ReturnType<typeof vi.spyOn>;

  async function setup(initialAccess: boolean): Promise<void> {
    // The component's computed() reads `authStore.hasPermissions(...)` three
    // times. Backing the mock with a signal makes the computed reactive: when
    // the signal flips, the computed re-evaluates and the effect runs.
    canAccessSignal = signal(initialAccess);
    const authStoreMock = {
      hasPermissions: vi.fn(() => canAccessSignal())
    };

    await TestBed.configureTestingModule({
      imports: [AdminPanelComponent, TranslocoTestingModuleWithLangs],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: AuthStore, useValue: authStoreMock }
      ]
    }).compileComponents();

    const router = TestBed.inject(Router);
    navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(AdminPanelComponent);
  }

  beforeEach(() => {
    canAccessSignal = signal(false);
  });

  it('does NOT redirect on initial render when user has access', async () => {
    await setup(true);
    fixture.detectChanges();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('redirects to /forbidden when permissions disappear mid-session', async () => {
    await setup(true);
    fixture.detectChanges();
    expect(navigateSpy).not.toHaveBeenCalled();

    // Simulate the live RBAC update — the underlying signal flips, the
    // computed re-evaluates, the effect fires.
    canAccessSignal.set(false);
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledWith(['/forbidden']);
  });

  it('redirects when component mounts without access (defensive double-check)', async () => {
    // The route guard would normally block this navigation, but if it ever
    // races or is bypassed (e.g. signal not yet hydrated), the component
    // should still self-correct.
    await setup(false);
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledWith(['/forbidden']);
  });
});
