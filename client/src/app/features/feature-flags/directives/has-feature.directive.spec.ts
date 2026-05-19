import { Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { HasFeatureDirective } from './has-feature.directive';
import { FeatureFlagsStore } from '../store/feature-flags.store';

@Component({
  imports: [HasFeatureDirective],
  template: `
    <ng-template #coming>
      <span data-testid="coming">COMING SOON</span>
    </ng-template>
    <span data-testid="active" *nxsHasFeature="flagKey(); else coming"
      >ACTIVE</span
    >
  `
})
class HostWithElseComponent {
  readonly flagKey = signal('new-dashboard');
}

@Component({
  imports: [HasFeatureDirective],
  template: `
    <span data-testid="active" *nxsHasFeature="flagKey()">ACTIVE</span>
  `
})
class HostWithoutElseComponent {
  readonly flagKey = signal('new-dashboard');
}

describe('HasFeatureDirective', () => {
  const flagsSignal = signal<Record<string, boolean>>({});

  const isEnabled = (key: string) => () => flagsSignal()[key] === true;

  const featureFlagsStoreMock = {
    isEnabled,
    flags: flagsSignal,
    loaded: signal(true)
  };

  beforeEach(() => {
    flagsSignal.set({});
  });

  const configure = async <T>(
    host: new () => T
  ): Promise<ComponentFixture<T>> => {
    await TestBed.configureTestingModule({
      imports: [host as never],
      providers: [
        { provide: FeatureFlagsStore, useValue: featureFlagsStoreMock }
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

  describe('with else template', () => {
    it('renders main template when flag is on', async () => {
      flagsSignal.set({ 'new-dashboard': true });
      const fixture = await configure(HostWithElseComponent);
      expect(text(fixture, 'active')).toBe('ACTIVE');
      expect(text(fixture, 'coming')).toBeNull();
    });

    it('renders else template when flag is off', async () => {
      flagsSignal.set({ 'new-dashboard': false });
      const fixture = await configure(HostWithElseComponent);
      expect(text(fixture, 'active')).toBeNull();
      expect(text(fixture, 'coming')).toBe('COMING SOON');
    });

    it('swaps templates when the underlying signal flips', async () => {
      flagsSignal.set({ 'new-dashboard': false });
      const fixture = await configure(HostWithElseComponent);
      expect(text(fixture, 'coming')).toBe('COMING SOON');

      flagsSignal.set({ 'new-dashboard': true });
      fixture.detectChanges();

      expect(text(fixture, 'active')).toBe('ACTIVE');
      expect(text(fixture, 'coming')).toBeNull();
    });

    it('reacts to the key input changing', async () => {
      flagsSignal.set({ a: true, b: false });
      const fixture = await configure(HostWithElseComponent);
      fixture.componentInstance.flagKey.set('a');
      fixture.detectChanges();
      expect(text(fixture, 'active')).toBe('ACTIVE');

      fixture.componentInstance.flagKey.set('b');
      fixture.detectChanges();
      expect(text(fixture, 'active')).toBeNull();
      expect(text(fixture, 'coming')).toBe('COMING SOON');
    });
  });

  describe('without else template', () => {
    it('renders nothing when flag is off', async () => {
      flagsSignal.set({ 'new-dashboard': false });
      const fixture = await configure(HostWithoutElseComponent);
      expect(text(fixture, 'active')).toBeNull();
    });

    it('renders the host template when flag is on', async () => {
      flagsSignal.set({ 'new-dashboard': true });
      const fixture = await configure(HostWithoutElseComponent);
      expect(text(fixture, 'active')).toBe('ACTIVE');
    });
  });
});
