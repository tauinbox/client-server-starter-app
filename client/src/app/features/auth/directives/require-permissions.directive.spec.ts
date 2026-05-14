import { Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequirePermissionsDirective } from './require-permissions.directive';
import { AuthStore } from '../store/auth.store';
import type { PermissionCheck } from '../casl/app-ability';

@Component({
  imports: [RequirePermissionsDirective],
  template: `
    <ng-template #denied>
      <span data-testid="denied">NO ACCESS</span>
    </ng-template>
    <span data-testid="granted" *nxsRequirePermissions="check(); else denied">
      ALLOWED
    </span>
  `
})
class HostWithElseComponent {
  readonly check = signal<PermissionCheck>({
    action: 'read',
    subject: 'User'
  });
}

@Component({
  imports: [RequirePermissionsDirective],
  template: `
    <span data-testid="granted" *nxsRequirePermissions="check()">
      ALLOWED
    </span>
  `
})
class HostWithoutElseComponent {
  readonly check = signal<PermissionCheck>({
    action: 'read',
    subject: 'User'
  });
}

describe('RequirePermissionsDirective', () => {
  let authStoreMock: { hasPermissions: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    authStoreMock = {
      hasPermissions: vi.fn().mockReturnValue(false)
    };
  });

  const configure = async <T>(
    host: new () => T
  ): Promise<ComponentFixture<T>> => {
    await TestBed.configureTestingModule({
      imports: [host as never],
      providers: [{ provide: AuthStore, useValue: authStoreMock }]
    }).compileComponents();

    const fixture = TestBed.createComponent(host);
    fixture.detectChanges();
    return fixture;
  };

  const text = (
    fixture: ComponentFixture<unknown>,
    testId: string
  ): string | null => {
    const root = fixture.nativeElement as HTMLElement;
    const el = root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    return el?.textContent?.trim() ?? null;
  };

  describe('with else template', () => {
    it('renders the main template when permissions are granted', async () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      const fixture = await configure(HostWithElseComponent);

      expect(text(fixture, 'granted')).toBe('ALLOWED');
      expect(text(fixture, 'denied')).toBeNull();
    });

    it('renders the else template when permissions are denied', async () => {
      authStoreMock.hasPermissions.mockReturnValue(false);
      const fixture = await configure(HostWithElseComponent);

      expect(text(fixture, 'granted')).toBeNull();
      expect(text(fixture, 'denied')).toBe('NO ACCESS');
    });

    it('swaps templates when permission input changes', async () => {
      authStoreMock.hasPermissions.mockReturnValue(false);
      const fixture = await configure(HostWithElseComponent);

      expect(text(fixture, 'denied')).toBe('NO ACCESS');

      authStoreMock.hasPermissions.mockReturnValue(true);
      fixture.componentInstance.check.set({
        action: 'update',
        subject: 'User'
      });
      fixture.detectChanges();

      expect(text(fixture, 'granted')).toBe('ALLOWED');
      expect(text(fixture, 'denied')).toBeNull();
    });
  });

  describe('without else template', () => {
    it('renders the main template when permissions are granted', async () => {
      authStoreMock.hasPermissions.mockReturnValue(true);
      const fixture = await configure(HostWithoutElseComponent);

      expect(text(fixture, 'granted')).toBe('ALLOWED');
    });

    it('renders nothing when permissions are denied', async () => {
      authStoreMock.hasPermissions.mockReturnValue(false);
      const fixture = await configure(HostWithoutElseComponent);

      expect(text(fixture, 'granted')).toBeNull();
    });
  });
});
