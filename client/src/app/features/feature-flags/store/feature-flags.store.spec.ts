import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { FeatureFlagsStore } from './feature-flags.store';
import { FeatureFlagService } from '../services/feature-flag.service';

describe('FeatureFlagsStore', () => {
  let getEvaluatedFlags: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getEvaluatedFlags = vi.fn().mockReturnValue(
      of({
        flags: { 'new-dashboard': false, 'beta-export': true },
        evaluatedAt: '2026-05-19T10:00:00Z'
      })
    );
    TestBed.configureTestingModule({
      providers: [
        FeatureFlagsStore,
        { provide: FeatureFlagService, useValue: { getEvaluatedFlags } }
      ]
    });
  });

  it('load() populates flags and sets loaded = true', async () => {
    const store = TestBed.inject(FeatureFlagsStore);
    expect(store.loaded()).toBe(false);
    await store.load();
    expect(store.loaded()).toBe(true);
    expect(store.flags()['beta-export']).toBe(true);
    expect(store.flags()['new-dashboard']).toBe(false);
  });

  it('isEnabled(key) is a reactive computed signal', async () => {
    const store = TestBed.inject(FeatureFlagsStore);
    const betaSig = store.isEnabled('beta-export');
    expect(betaSig()).toBe(false); // not yet loaded
    await store.load();
    expect(betaSig()).toBe(true);
  });

  it('reload() re-fetches and replaces flags', async () => {
    const store = TestBed.inject(FeatureFlagsStore);
    await store.load();
    expect(store.flags()['new-dashboard']).toBe(false);

    getEvaluatedFlags.mockReturnValue(
      of({
        flags: { 'new-dashboard': true, 'beta-export': false },
        evaluatedAt: '2026-05-19T10:01:00Z'
      })
    );
    await store.reload();
    expect(store.flags()['new-dashboard']).toBe(true);
    expect(store.flags()['beta-export']).toBe(false);
    expect(getEvaluatedFlags).toHaveBeenCalledTimes(2);
  });

  it('load() failure still marks loaded = true (best-effort)', async () => {
    getEvaluatedFlags.mockReturnValue(throwError(() => new Error('boom')));
    const store = TestBed.inject(FeatureFlagsStore);
    await store.load();
    expect(store.loaded()).toBe(true);
    expect(store.flags()).toEqual({});
  });

  it('clear() resets flags and loaded', async () => {
    const store = TestBed.inject(FeatureFlagsStore);
    await store.load();
    expect(store.loaded()).toBe(true);
    store.clear();
    expect(store.loaded()).toBe(false);
    expect(store.flags()).toEqual({});
  });
});
