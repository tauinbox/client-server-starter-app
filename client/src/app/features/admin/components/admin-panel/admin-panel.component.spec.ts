import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranslocoTestingModuleWithLangs } from '../../../../../test-utils/transloco-testing';

import { AdminPanelComponent } from './admin-panel.component';
import { AuthStore } from '@features/auth/store/auth.store';

describe('AdminPanelComponent — auto-redirect on permission loss', () => {
  let fixture: ComponentFixture<AdminPanelComponent>;
  let canAccessSignal: ReturnType<typeof signal<boolean>>;
  let isAuthenticatedSignal: ReturnType<typeof signal<boolean>>;
  let navigateSpy: ReturnType<typeof vi.spyOn>;

  async function setup(
    initialAccess: boolean,
    initialAuthenticated = true
  ): Promise<void> {
    canAccessSignal = signal(initialAccess);
    isAuthenticatedSignal = signal(initialAuthenticated);
    const authStoreMock = {
      hasPermissions: vi.fn(() => canAccessSignal()),
      isAuthenticated: isAuthenticatedSignal
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
    isAuthenticatedSignal = signal(true);
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

    canAccessSignal.set(false);
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledWith(['/forbidden']);
  });

  it('redirects when component mounts without access', async () => {
    await setup(false);
    fixture.detectChanges();

    expect(navigateSpy).toHaveBeenCalledWith(['/forbidden']);
  });

  it('does NOT redirect to /forbidden during logout', async () => {
    await setup(true);
    fixture.detectChanges();
    expect(navigateSpy).not.toHaveBeenCalled();

    isAuthenticatedSignal.set(false);
    canAccessSignal.set(false);
    fixture.detectChanges();

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does NOT redirect when component mounts unauthenticated without access', async () => {
    await setup(false, false);
    fixture.detectChanges();

    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
