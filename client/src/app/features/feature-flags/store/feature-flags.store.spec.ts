import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { FeatureFlagsStore } from './feature-flags.store';
import { FeatureFlagService } from '../services/feature-flag.service';

type FlagsResponse = {
  flags: Record<string, boolean>;
  evaluatedAt: string;
};

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

  it('concurrent load() calls share one request', async () => {
    const subject = new Subject<FlagsResponse>();
    getEvaluatedFlags.mockReturnValue(subject);
    const store = TestBed.inject(FeatureFlagsStore);

    const first = store.load();
    const second = store.load();
    expect(getEvaluatedFlags).toHaveBeenCalledTimes(1);

    subject.next({
      flags: { 'beta-export': true },
      evaluatedAt: '2026-05-19T10:00:00Z'
    });
    subject.complete();
    await Promise.all([first, second]);
    expect(store.flags()['beta-export']).toBe(true);
  });

  it('load() is a no-op when flags are already loaded', async () => {
    const store = TestBed.inject(FeatureFlagsStore);
    await store.load();
    await store.load();
    expect(getEvaluatedFlags).toHaveBeenCalledTimes(1);
  });

  it('load() joins an in-flight reload()', async () => {
    const store = TestBed.inject(FeatureFlagsStore);
    await store.load();

    const subject = new Subject<FlagsResponse>();
    getEvaluatedFlags.mockReturnValue(subject);
    const reloading = store.reload();
    const joined = store.load();
    expect(getEvaluatedFlags).toHaveBeenCalledTimes(2);

    subject.next({
      flags: { 'new-dashboard': true },
      evaluatedAt: '2026-05-19T10:01:00Z'
    });
    subject.complete();
    await Promise.all([reloading, joined]);
    expect(store.flags()['new-dashboard']).toBe(true);
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

  it('load() failure keeps loaded = false and the next load() retries', async () => {
    getEvaluatedFlags.mockReturnValue(throwError(() => new Error('boom')));
    const store = TestBed.inject(FeatureFlagsStore);
    await store.load();
    expect(store.loaded()).toBe(false);
    expect(store.flags()).toEqual({});

    getEvaluatedFlags.mockReturnValue(
      of({
        flags: { 'beta-export': true },
        evaluatedAt: '2026-05-19T10:02:00Z'
      })
    );
    await store.load();
    expect(store.loaded()).toBe(true);
    expect(store.flags()['beta-export']).toBe(true);
  });

  it('clear() resets flags and loaded', async () => {
    const store = TestBed.inject(FeatureFlagsStore);
    await store.load();
    expect(store.loaded()).toBe(true);
    store.clear();
    expect(store.loaded()).toBe(false);
    expect(store.flags()).toEqual({});
  });

  it('a response arriving after clear() is discarded', async () => {
    const subject = new Subject<FlagsResponse>();
    getEvaluatedFlags.mockReturnValue(subject);
    const store = TestBed.inject(FeatureFlagsStore);

    const loading = store.load();
    store.clear();
    subject.next({
      flags: { 'beta-export': true },
      evaluatedAt: '2026-05-19T10:00:00Z'
    });
    subject.complete();
    await loading;

    expect(store.loaded()).toBe(false);
    expect(store.flags()).toEqual({});
  });
});
