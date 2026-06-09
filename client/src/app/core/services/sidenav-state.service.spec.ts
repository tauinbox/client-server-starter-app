import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SidenavStateService } from './sidenav-state.service';
import { LayoutService } from './layout.service';
import { LocalStorageService } from './local-storage.service';
import { AuthStore } from '@features/auth/store/auth.store';
import { FeatureFlagsStore } from '@features/feature-flags/store/feature-flags.store';

describe('SidenavStateService — nav-link source and defaultRoute', () => {
  let adminAccessSignal: ReturnType<typeof signal<boolean>>;
  let billingSignal: ReturnType<typeof signal<boolean>>;
  let userSignal: ReturnType<typeof signal<{ id: string } | null>>;

  function setup(): SidenavStateService {
    adminAccessSignal = signal(false);
    billingSignal = signal(false);
    userSignal = signal<{ id: string } | null>(null);

    const authStoreMock = {
      hasPermissions: vi.fn(() => adminAccessSignal()),
      user: userSignal
    };

    const storageMock = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    };

    const layoutMock = {
      isHandset: signal(false),
      isTablet: signal(false),
      isWeb: signal(true)
    };

    const flagsStoreMock = {
      isEnabled: vi.fn((key: string) =>
        key === 'billing' ? billingSignal : signal(false)
      )
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthStore, useValue: authStoreMock },
        { provide: LocalStorageService, useValue: storageMock },
        { provide: LayoutService, useValue: layoutMock },
        { provide: FeatureFlagsStore, useValue: flagsStoreMock }
      ]
    });

    return TestBed.inject(SidenavStateService);
  }

  beforeEach(() => {
    adminAccessSignal = signal(false);
    billingSignal = signal(false);
  });

  describe('navLinks', () => {
    it('is empty when user has no admin permissions', () => {
      const service = setup();
      expect(service.navLinks()).toEqual([]);
    });

    it('contains the admin link when user can access the admin panel', () => {
      const service = setup();
      adminAccessSignal.set(true);

      expect(service.navLinks()).toHaveLength(1);
      expect(service.navLinks()[0]).toMatchObject({
        route: '/admin',
        labelKey: 'sidenav.adminPanel',
        icon: 'admin_panel_settings'
      });
    });

    it('reactively updates when permissions change', () => {
      const service = setup();
      expect(service.navLinks()).toEqual([]);

      adminAccessSignal.set(true);
      expect(service.navLinks()).toHaveLength(1);

      adminAccessSignal.set(false);
      expect(service.navLinks()).toEqual([]);
    });

    it('contains the billing link only when the billing flag is enabled', () => {
      const service = setup();
      expect(service.navLinks()).toEqual([]);

      billingSignal.set(true);
      expect(service.navLinks()).toHaveLength(1);
      expect(service.navLinks()[0]).toMatchObject({
        route: '/billing',
        labelKey: 'sidenav.billing',
        icon: 'credit_card'
      });
    });

    it('orders admin before billing when both are visible', () => {
      const service = setup();
      adminAccessSignal.set(true);
      billingSignal.set(true);

      expect(service.navLinks().map((l) => l.route)).toEqual([
        '/admin',
        '/billing'
      ]);
    });
  });

  describe('defaultRoute', () => {
    it('falls back to /profile when no nav links are accessible', () => {
      const service = setup();
      expect(service.defaultRoute()).toBe('/profile');
    });

    it('returns the first accessible nav link route', () => {
      const service = setup();
      adminAccessSignal.set(true);
      expect(service.defaultRoute()).toBe('/admin');
    });

    it('flips between first nav link and /profile as permissions change', () => {
      const service = setup();
      expect(service.defaultRoute()).toBe('/profile');

      adminAccessSignal.set(true);
      expect(service.defaultRoute()).toBe('/admin');

      adminAccessSignal.set(false);
      expect(service.defaultRoute()).toBe('/profile');
    });

    it('never lands on billing — falls back to /profile when only billing is visible', () => {
      const service = setup();
      billingSignal.set(true);
      expect(service.navLinks()).toHaveLength(1);
      expect(service.defaultRoute()).toBe('/profile');
    });
  });
});
