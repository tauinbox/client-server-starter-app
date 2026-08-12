import { Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HasEntitlementDirective } from './has-entitlement.directive';
import { EntitlementsStore } from '../store/entitlements.store';

@Component({
  imports: [HasEntitlementDirective],
  template: `
    <ng-template #upgrade>
      <span data-testid="upgrade">UPGRADE</span>
    </ng-template>
    <span data-testid="granted" *nxsHasEntitlement="capability(); else upgrade"
      >REPORTS</span
    >
  `
})
class HostWithElseComponent {
  readonly capability = signal('reports');
}

@Component({
  imports: [HasEntitlementDirective],
  template: `
    <span data-testid="granted" *nxsHasEntitlement="capability()">REPORTS</span>
  `
})
class HostWithoutElseComponent {
  readonly capability = signal('reports');
}

describe('HasEntitlementDirective', () => {
  const capabilitiesSignal = signal<string[]>([]);
  const load = vi.fn().mockResolvedValue(undefined);

  const entitlementsStoreMock = {
    load,
    has: (capability: string) => () =>
      capabilitiesSignal().includes(capability),
    capabilities: capabilitiesSignal,
    loaded: signal(true)
  };

  beforeEach(() => {
    capabilitiesSignal.set([]);
    load.mockClear();
  });

  const configure = async <T>(
    host: new () => T
  ): Promise<ComponentFixture<T>> => {
    await TestBed.configureTestingModule({
      imports: [host as never],
      providers: [
        { provide: EntitlementsStore, useValue: entitlementsStoreMock }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(host);
    fixture.detectChanges();
    return fixture;
  };

  const text = (
    fixture: ComponentFixture<unknown>,
    id: string
  ): string | null => {
    const root = fixture.nativeElement as HTMLElement;
    return (
      root
        .querySelector<HTMLElement>(`[data-testid="${id}"]`)
        ?.textContent?.trim() ?? null
    );
  };

  it('triggers the lazy load so a gated surface needs no resolver', async () => {
    await configure(HostWithoutElseComponent);
    expect(load).toHaveBeenCalledTimes(1);
  });

  describe('with else template', () => {
    it('renders the host template when the capability is granted', async () => {
      capabilitiesSignal.set(['reports']);
      const fixture = await configure(HostWithElseComponent);
      expect(text(fixture, 'granted')).toBe('REPORTS');
      expect(text(fixture, 'upgrade')).toBeNull();
    });

    it('renders the else template when it is not', async () => {
      capabilitiesSignal.set(['data-export']);
      const fixture = await configure(HostWithElseComponent);
      expect(text(fixture, 'granted')).toBeNull();
      expect(text(fixture, 'upgrade')).toBe('UPGRADE');
    });

    it('swaps templates when the mirror updates, e.g. after an entitlements push', async () => {
      const fixture = await configure(HostWithElseComponent);
      expect(text(fixture, 'upgrade')).toBe('UPGRADE');

      capabilitiesSignal.set(['reports']);
      fixture.detectChanges();

      expect(text(fixture, 'granted')).toBe('REPORTS');
      expect(text(fixture, 'upgrade')).toBeNull();
    });

    it('reacts to the capability input changing', async () => {
      capabilitiesSignal.set(['reports']);
      const fixture = await configure(HostWithElseComponent);
      expect(text(fixture, 'granted')).toBe('REPORTS');

      fixture.componentInstance.capability.set('priority-support');
      fixture.detectChanges();

      expect(text(fixture, 'granted')).toBeNull();
      expect(text(fixture, 'upgrade')).toBe('UPGRADE');
    });
  });

  describe('without else template', () => {
    it('fails closed while the mirror is empty', async () => {
      const fixture = await configure(HostWithoutElseComponent);
      expect(text(fixture, 'granted')).toBeNull();
    });

    it('renders the host template once the capability is granted', async () => {
      capabilitiesSignal.set(['reports']);
      const fixture = await configure(HostWithoutElseComponent);
      expect(text(fixture, 'granted')).toBe('REPORTS');
    });
  });
});
