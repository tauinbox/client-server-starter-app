import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import type { EntitlementsResponse } from '@app/shared/types';
import { EntitlementsStore } from './entitlements.store';
import { BillingService } from '../services/billing.service';

const PRO: EntitlementsResponse = {
  planKey: 'pro',
  capabilities: ['reports', 'data-export'],
  limits: { sessions: 10 }
};

const FREE: EntitlementsResponse = {
  planKey: 'free',
  capabilities: [],
  limits: {}
};

describe('EntitlementsStore', () => {
  let getEntitlements: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getEntitlements = vi.fn().mockReturnValue(of(PRO));
    TestBed.configureTestingModule({
      providers: [
        EntitlementsStore,
        { provide: BillingService, useValue: { getEntitlements } }
      ]
    });
  });

  it('load() populates the whole resolved set, limits included', async () => {
    const store = TestBed.inject(EntitlementsStore);
    expect(store.loaded()).toBe(false);

    await store.load();

    expect(store.loaded()).toBe(true);
    expect(store.planKey()).toBe('pro');
    expect(store.capabilities()).toEqual(['reports', 'data-export']);
    expect(store.limits()).toEqual({ sessions: 10 });
  });

  it('has(capability) is a reactive computed signal that fails closed until loaded', async () => {
    const store = TestBed.inject(EntitlementsStore);
    const reports = store.has('reports');
    expect(reports()).toBe(false);

    await store.load();

    expect(reports()).toBe(true);
    expect(store.has('priority-support')()).toBe(false);
  });

  it('limit(key) reports the plan number, null when the plan carries none', async () => {
    const store = TestBed.inject(EntitlementsStore);
    await store.load();

    expect(store.limit('sessions')()).toBe(10);
    expect(store.limit('records')()).toBeNull();
  });

  it('concurrent load() calls share one request', async () => {
    const subject = new Subject<EntitlementsResponse>();
    getEntitlements.mockReturnValue(subject);
    const store = TestBed.inject(EntitlementsStore);

    const first = store.load();
    const second = store.load();
    expect(getEntitlements).toHaveBeenCalledTimes(1);

    subject.next(PRO);
    subject.complete();
    await Promise.all([first, second]);

    expect(store.capabilities()).toEqual(['reports', 'data-export']);
  });

  it('load() resolves without a second request once loaded', async () => {
    const store = TestBed.inject(EntitlementsStore);
    await store.load();
    await store.load();
    expect(getEntitlements).toHaveBeenCalledTimes(1);
  });

  it('reload() always re-fetches, so an entitlements push is not swallowed', async () => {
    const store = TestBed.inject(EntitlementsStore);
    await store.load();

    getEntitlements.mockReturnValue(of(FREE));
    await store.reload();

    expect(getEntitlements).toHaveBeenCalledTimes(2);
    expect(store.planKey()).toBe('free');
    expect(store.has('reports')()).toBe(false);
  });

  it('keeps loaded = false on a transient failure so consumers retry', async () => {
    getEntitlements.mockReturnValue(throwError(() => new Error('offline')));
    const store = TestBed.inject(EntitlementsStore);

    await store.load();

    expect(store.loaded()).toBe(false);
    expect(store.capabilities()).toEqual([]);

    getEntitlements.mockReturnValue(of(PRO));
    await store.load();
    expect(store.loaded()).toBe(true);
  });

  it('clear() drops the mirror so a previous session cannot leak into the next', async () => {
    const store = TestBed.inject(EntitlementsStore);
    await store.load();

    store.clear();

    expect(store.loaded()).toBe(false);
    expect(store.planKey()).toBeNull();
    expect(store.capabilities()).toEqual([]);
    expect(store.limits()).toEqual({});
  });

  it('a response in flight when clear() runs cannot repopulate the mirror', async () => {
    const subject = new Subject<EntitlementsResponse>();
    getEntitlements.mockReturnValue(subject);
    const store = TestBed.inject(EntitlementsStore);

    const pending = store.load();
    store.clear();
    subject.next(PRO);
    subject.complete();
    await pending;

    expect(store.loaded()).toBe(false);
    expect(store.capabilities()).toEqual([]);
  });
});
