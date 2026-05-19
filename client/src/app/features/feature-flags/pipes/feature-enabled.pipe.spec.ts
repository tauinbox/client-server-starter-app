import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FeatureEnabledPipe } from './feature-enabled.pipe';
import { FeatureFlagsStore } from '../store/feature-flags.store';

@Component({
  imports: [FeatureEnabledPipe],
  template: `<span data-testid="badge" [class.beta]="flagKey() | featureEnabled"
    >x</span
  >`
})
class HostComponent {
  readonly flagKey = signal('beta-export');
}

describe('FeatureEnabledPipe', () => {
  const flagsSignal = signal<Record<string, boolean>>({});

  const isEnabled = (key: string) => () => flagsSignal()[key] === true;

  const featureFlagsStoreMock = {
    isEnabled,
    flags: flagsSignal,
    loaded: signal(true)
  };

  beforeEach(() => {
    flagsSignal.set({});
    TestBed.configureTestingModule({
      providers: [
        { provide: FeatureFlagsStore, useValue: featureFlagsStoreMock }
      ]
    });
  });

  it('returns true when the flag is on', async () => {
    flagsSignal.set({ 'beta-export': true });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const span = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="badge"]'
    );
    expect(span?.classList.contains('beta')).toBe(true);
  });

  it('returns false when the flag is off', async () => {
    flagsSignal.set({ 'beta-export': false });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const span = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="badge"]'
    );
    expect(span?.classList.contains('beta')).toBe(false);
  });

  it('re-evaluates when the underlying store signal updates', async () => {
    flagsSignal.set({ 'beta-export': false });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const span = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="badge"]'
    );
    expect(span?.classList.contains('beta')).toBe(false);

    flagsSignal.set({ 'beta-export': true });
    fixture.detectChanges();
    expect(span?.classList.contains('beta')).toBe(true);
  });
});
